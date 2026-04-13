import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { PROJECT_VERSION_MANUAL_STATUS_VALUES } from "@vivd/shared/types";
import {
  protectedProcedure,
  adminProcedure,
  orgAdminProcedure,
  ownerProcedure,
  projectMemberProcedure,
} from "../../trpc";
import {
  getActiveTenantId,
  getProjectsRootDir,
  getTenantProjectsDir,
  getProjectDir,
  getVersionDir,
  getManifest,
  getVersionData,
  isLegacyProject,
  migrateProjectIfNeeded,
  listProjectSlugs,
  deleteVersion as deleteVersionUtil,
} from "../../generator/versionUtils";
import path from "path";
import fs from "fs";
import { publishService } from "../../services/publish/PublishService";
import { db } from "../../db";
import {
  organization,
  pluginEntitlement,
  projectMember,
  projectMeta,
  projectPluginInstance,
  projectPublishChecklist,
  projectVersion,
  publishedSite,
  usageRecord,
} from "../../db/schema";
import { eq, and } from "drizzle-orm";
import {
  getVivdInternalFilesPath,
  migrateVivdInternalArtifactsInVersion,
  VIVD_INTERNAL_ARTIFACT_FILENAMES,
} from "../../generator/vivdPaths";
import { thumbnailService } from "../../services/project/ThumbnailService";
import {
  renderProjectTemplateFiles,
  TEMPLATE_FILES,
} from "../../generator/templateFiles";
import type { GenerationSource } from "../../generator/flows/types";
import {
  createS3Client,
  doesObjectExist,
  getObjectStorageConfigFromEnv,
  uploadDirectoryToBucket,
} from "../../services/storage/ObjectStorageService";
import { migrateProjectMetadataToDbFromFilesystem } from "../../services/project/ProjectMetaMigrationService";
import {
  copyProjectArtifactsInBucket,
  deleteProjectArtifactsFromBucket,
  deleteProjectVersionArtifactsFromBucket,
} from "../../services/project/ProjectArtifactsService";
import { studioMachineProvider } from "../../services/studioMachines";
import { cleanupManagedStudioMachinesForDeletedProject } from "../../services/studioMachines/deleteCleanup";
import { isManagedStudioMachineProvider } from "../../services/studioMachines/types";
import { projectMetaService } from "../../services/project/ProjectMetaService";
import { getProjectArtifactKeyPrefix } from "../../services/project/ProjectStoragePaths";
import { rewriteProjectArtifactKeyForSlug } from "../../services/project/slugRename";
import { projectStatusOverrideService } from "../../services/project/ProjectStatusOverrideService";
import { renamePluginProjectDataForSlugChange } from "../../services/plugins/integrationHooks";

const PROJECT_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function normalizeProjectSlug(input: string, fieldName: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  if (!PROJECT_SLUG_PATTERN.test(normalized)) {
    throw new Error(
      `${fieldName} must use lowercase letters, numbers, and hyphens only`,
    );
  }
  return normalized;
}

function normalizeProjectTitle(input: string): string {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error("Project title is required");
  }
  return normalized;
}

function rewriteChecklistProjectSlug(checklist: unknown, newSlug: string): unknown {
  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) {
    return checklist;
  }

  return {
    ...(checklist as Record<string, unknown>),
    projectSlug: newSlug,
  };
}

function moveDirectory(fromPath: string, toPath: string): void {
  if (!fs.existsSync(fromPath)) return;
  if (fs.existsSync(toPath)) {
    throw new Error(`Target path already exists: ${toPath}`);
  }

  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  try {
    fs.renameSync(fromPath, toPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw err;
    fs.cpSync(fromPath, toPath, { recursive: true });
    fs.rmSync(fromPath, { recursive: true, force: true });
  }
}

export const projectMaintenanceProcedures = {
  /**
   * Org-admin endpoint to manually override a project's current version status.
   */
  setStatus: orgAdminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().int().positive().optional(),
        status: z.enum(PROJECT_VERSION_MANUAL_STATUS_VALUES),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      projectStatusOverrideService.setVersionStatus({
        organizationId: ctx.organizationId ?? "default",
        slug: input.slug,
        version: input.version,
        status: input.status,
      }),
    ),

  /**
   * Backward-compatible alias for forcing a project version into `failed`.
   */
  resetStatus: orgAdminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      projectStatusOverrideService.setVersionStatus({
        organizationId: ctx.organizationId ?? "default",
        slug: input.slug,
        version: input.version,
        status: "failed",
      }),
    ),

  updateTitle: adminProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const slug = input.slug.trim();
      if (!slug) {
        throw new Error("Project slug is required");
      }

      const title = normalizeProjectTitle(input.title);
      const result = await projectMetaService.setProjectTitle({
        organizationId,
        slug,
        title,
      });

      return {
        success: true,
        slug,
        title,
        updatedVersions: result.updatedVersions,
        message: `Updated project title for "${slug}"`,
      };
    }),

  /**
   * Rename a project slug within the same organization.
   *
   * V1 safety constraints:
   * - project must be unpublished
   * - copy bucket prefix first, then DB cutover in transaction
   */
  renameSlug: adminProcedure
    .input(
      z.object({
        oldSlug: z.string().min(1),
        newSlug: z.string().min(1),
        confirmationText: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const oldSlug = normalizeProjectSlug(input.oldSlug, "oldSlug");
      const newSlug = normalizeProjectSlug(input.newSlug, "newSlug");
      const confirmationText = normalizeProjectSlug(
        input.confirmationText,
        "confirmationText",
      );

      if (oldSlug === newSlug) {
        throw new Error("New slug must be different from the current slug.");
      }
      if (confirmationText !== newSlug) {
        throw new Error("Confirmation text must match the new slug.");
      }

      const sourceProject = await projectMetaService.getProject(organizationId, oldSlug);
      if (!sourceProject) {
        throw new Error("Project not found.");
      }

      const existingTarget = await projectMetaService.getProject(organizationId, newSlug);
      if (existingTarget) {
        throw new Error(`Project slug "${newSlug}" is already in use.`);
      }

      const publishInfo = await publishService.getPublishedInfo(organizationId, oldSlug);
      if (publishInfo) {
        throw new Error(
          `Cannot rename a published project. Unpublish "${publishInfo.domain}" first.`,
        );
      }

      const versions = await projectMetaService.listProjectVersions(organizationId, oldSlug);
      for (const versionRow of versions) {
        try {
          await studioMachineProvider.stop(
            organizationId,
            oldSlug,
            versionRow.version,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[RenameSlug] Failed to stop studio for ${oldSlug}/v${versionRow.version}: ${message}`,
          );
        }
      }

      let bucketObjectsCopied = 0;
      try {
        const copyRes = await copyProjectArtifactsInBucket({
          organizationId,
          sourceSlug: oldSlug,
          targetSlug: newSlug,
        });
        if (copyRes.copied) {
          bucketObjectsCopied = copyRes.objectsCopied;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to copy project artifacts for rename: ${message}`);
      }

      let dbRowsMoved = 0;
      try {
        await db.transaction(async (tx) => {
          const source = await tx.query.projectMeta.findFirst({
            where: and(
              eq(projectMeta.organizationId, organizationId),
              eq(projectMeta.slug, oldSlug),
            ),
          });
          if (!source) {
            throw new Error("Project not found during rename.");
          }

          const target = await tx.query.projectMeta.findFirst({
            where: and(
              eq(projectMeta.organizationId, organizationId),
              eq(projectMeta.slug, newSlug),
            ),
            columns: { slug: true },
          });
          if (target) {
            throw new Error(`Project slug "${newSlug}" is already in use.`);
          }

          await tx.insert(projectMeta).values({
            ...source,
            slug: newSlug,
            updatedAt: new Date(),
          });
          dbRowsMoved += 1;

          const sourceVersions = await tx
            .select()
            .from(projectVersion)
            .where(
              and(
                eq(projectVersion.organizationId, organizationId),
                eq(projectVersion.projectSlug, oldSlug),
              ),
            );
          if (sourceVersions.length > 0) {
            await tx.insert(projectVersion).values(
              sourceVersions.map((row) => ({
                ...row,
                id: randomUUID(),
                projectSlug: newSlug,
                thumbnailKey: rewriteProjectArtifactKeyForSlug({
                  organizationId,
                  oldSlug,
                  newSlug,
                  key: row.thumbnailKey,
                }),
              })),
            );
            dbRowsMoved += sourceVersions.length;
          }

          const sourceChecklists = await tx
            .select()
            .from(projectPublishChecklist)
            .where(
              and(
                eq(projectPublishChecklist.organizationId, organizationId),
                eq(projectPublishChecklist.projectSlug, oldSlug),
              ),
            );
          if (sourceChecklists.length > 0) {
            await tx.insert(projectPublishChecklist).values(
              sourceChecklists.map((row) => ({
                ...row,
                id: randomUUID(),
                projectSlug: newSlug,
                checklist: rewriteChecklistProjectSlug(row.checklist, newSlug),
              })),
            );
            dbRowsMoved += sourceChecklists.length;
          }

          const updatedPlugins = await tx
            .update(projectPluginInstance)
            .set({ projectSlug: newSlug, updatedAt: new Date() })
            .where(
              and(
                eq(projectPluginInstance.organizationId, organizationId),
                eq(projectPluginInstance.projectSlug, oldSlug),
              ),
            )
            .returning({ id: projectPluginInstance.id });
          dbRowsMoved += updatedPlugins.length;

          dbRowsMoved += await renamePluginProjectDataForSlugChange({
            tx,
            organizationId,
            oldSlug,
            newSlug,
          });

          const updatedMembers = await tx
            .update(projectMember)
            .set({ projectSlug: newSlug })
            .where(
              and(
                eq(projectMember.organizationId, organizationId),
                eq(projectMember.projectSlug, oldSlug),
              ),
            )
            .returning({ id: projectMember.id });
          dbRowsMoved += updatedMembers.length;

          const updatedEntitlements = await tx
            .update(pluginEntitlement)
            .set({ projectSlug: newSlug, updatedAt: new Date() })
            .where(
              and(
                eq(pluginEntitlement.organizationId, organizationId),
                eq(pluginEntitlement.scope, "project"),
                eq(pluginEntitlement.projectSlug, oldSlug),
              ),
            )
            .returning({ id: pluginEntitlement.id });
          dbRowsMoved += updatedEntitlements.length;

          const updatedUsage = await tx
            .update(usageRecord)
            .set({ projectSlug: newSlug })
            .where(
              and(
                eq(usageRecord.organizationId, organizationId),
                eq(usageRecord.projectSlug, oldSlug),
              ),
            )
            .returning({ id: usageRecord.id });
          dbRowsMoved += updatedUsage.length;

          const deletedSourceProject = await tx
            .delete(projectMeta)
            .where(
              and(
                eq(projectMeta.organizationId, organizationId),
                eq(projectMeta.slug, oldSlug),
              ),
            )
            .returning({ slug: projectMeta.slug });

          if (deletedSourceProject.length === 0) {
            throw new Error("Failed to finalize slug rename.");
          }
        });
      } catch (err) {
        if (bucketObjectsCopied > 0) {
          try {
            await deleteProjectArtifactsFromBucket({
              organizationId,
              slug: newSlug,
            });
          } catch (cleanupErr) {
            const cleanupMessage =
              cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            console.warn(
              `[RenameSlug] Failed to cleanup copied artifacts after DB failure (${organizationId}/${newSlug}): ${cleanupMessage}`,
            );
          }
        }
        throw err;
      }

      const warnings: string[] = [];

      const tenantSourceDir = path.join(getTenantProjectsDir(organizationId), oldSlug);
      const tenantTargetDir = path.join(getTenantProjectsDir(organizationId), newSlug);
      const legacySourceDir = path.join(getProjectsRootDir(), oldSlug);
      const legacyTargetDir = path.join(getProjectsRootDir(), newSlug);

      const movePairs = [
        { from: tenantSourceDir, to: tenantTargetDir },
        { from: legacySourceDir, to: legacyTargetDir },
      ];

      const seen = new Set<string>();
      for (const pair of movePairs) {
        const key = `${pair.from}=>${pair.to}`;
        if (seen.has(key)) continue;
        seen.add(key);

        try {
          moveDirectory(pair.from, pair.to);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(
            `Local filesystem move failed (${pair.from} -> ${pair.to}): ${message}`,
          );
          console.warn(
            `[RenameSlug] Local move failed for ${pair.from} -> ${pair.to}: ${message}`,
          );
        }
      }

      let bucketObjectsDeleted: number | null = null;
      try {
        const cleanupRes = await deleteProjectArtifactsFromBucket({
          organizationId,
          slug: oldSlug,
        });
        if (cleanupRes.deleted) {
          bucketObjectsDeleted = cleanupRes.objectsDeleted;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Source artifact cleanup failed: ${message}`);
        console.warn(
          `[RenameSlug] Source artifact cleanup failed for ${organizationId}/${oldSlug}: ${message}`,
        );
      }

      return {
        success: true,
        oldSlug,
        newSlug,
        warnings,
        summary: {
          dbRowsMoved,
          bucketObjectsCopied,
          bucketObjectsDeleted,
        },
      };
    }),

  /**
   * Admin maintenance: move vivd process files into `.vivd/` for all versions.
   * Keeps the version root clean and prevents accidental public access to process artifacts.
   */
  migrateVivdProcessFiles: ownerProcedure.mutation(async ({ ctx }) => {
    const organizationId = ctx.organizationId ?? "default";
    const projectDirs = await listProjectSlugs(organizationId);
    if (projectDirs.length === 0) {
      return {
        success: true,
        projectsScanned: 0,
        legacyProjectsMigrated: 0,
        versionsScanned: 0,
        versionsTouched: 0,
        moved: Object.fromEntries(
          VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
        ),
        movedToLegacy: Object.fromEntries(
          VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
        ),
        errors: [] as Array<{
          slug: string;
          versionDir: string;
          error: string;
        }>,
      };
    }

    const moved: Record<string, number> = Object.fromEntries(
      VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
    );
    const movedToLegacy: Record<string, number> = Object.fromEntries(
      VIVD_INTERNAL_ARTIFACT_FILENAMES.map((f) => [f, 0])
    );

    let projectsScanned = 0;
    let legacyProjectsMigrated = 0;
    let versionsScanned = 0;
    let versionsTouched = 0;
    const errors: Array<{ slug: string; versionDir: string; error: string }> =
      [];

    for (const slug of projectDirs) {
      projectsScanned++;

      try {
        if (isLegacyProject(slug)) {
          const did = migrateProjectIfNeeded(slug);
          if (did) legacyProjectsMigrated++;
        }
      } catch (e) {
        errors.push({
          slug,
          versionDir: getProjectDir(organizationId, slug),
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const projectDir = getProjectDir(organizationId, slug);
      if (!fs.existsSync(projectDir)) continue;

      // Only treat directories with a manifest as projects; legacy projects are handled above.
      const manifest = await getManifest(organizationId, slug);
      if (!manifest) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        versionsScanned++;

        try {
          const res = migrateVivdInternalArtifactsInVersion(versionDir);
          if (res.moved.length || res.movedToLegacy.length) versionsTouched++;
          for (const item of res.moved) moved[item.filename]++;
          for (const item of res.movedToLegacy) movedToLegacy[item.filename]++;
        } catch (e) {
          errors.push({
            slug,
            versionDir,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      success: true,
      projectsScanned,
      legacyProjectsMigrated,
      versionsScanned,
      versionsTouched,
      moved,
      movedToLegacy,
      errors,
    };
  }),

  /**
   * Admin maintenance: migrate file-backed project metadata into the database.
   * Imports `manifest.json`, `.vivd/project.json`, `.vivd/publish-checklist.json`, and thumbnail artifacts.
   */
  migrateProjectMetadataToDb: ownerProcedure.mutation(async () => {
    return migrateProjectMetadataToDbFromFilesystem();
  }),

  /**
   * Admin maintenance: ensure project template files (currently .gitignore) exist in all versions.
   * Can be re-run with overwrite=true to update templates across all projects.
   */
  migrateProjectTemplateFiles: ownerProcedure
    .input(
      z
        .object({
          overwrite: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId ?? "default";
      const overwrite = input?.overwrite ?? false;
      const organizationRows = await db
        .select({ id: organization.id })
        .from(organization);
      const tenantIds = organizationRows.length
        ? organizationRows.map((row) => row.id)
        : [organizationId];
      const { bucket, endpointUrl, region, accessKeyId, secretAccessKey, sessionToken } =
        getObjectStorageConfigFromEnv();
      const client = createS3Client({
        bucket,
        endpointUrl,
        region,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      });

      const written: Record<string, number> = {
        ".gitignore": 0,
      };

      let tenantsScanned = 0;
      let projectsScanned = 0;
      let legacyProjectsMigrated = 0;
      let versionsScanned = 0;
      let versionsTouched = 0;
      const errors: Array<{
        organizationId: string;
        slug: string;
        versionDir: string;
        error: string;
      }> = [];
      if (tenantIds.length === 0) {
        return {
          success: true,
          tenantsScanned,
          projectsScanned,
          legacyProjectsMigrated,
          versionsScanned,
          versionsTouched,
          written,
          errors,
        };
      }

      for (const tenantId of tenantIds) {
        tenantsScanned++;
        const projectDirs = await listProjectSlugs(tenantId);

        for (const slug of projectDirs) {
          projectsScanned++;

          const manifest = await getManifest(tenantId, slug);
          if (!manifest) continue;

          for (const { version: versionNumber } of manifest.versions) {
            versionsScanned++;

            const versionData =
              Number.isFinite(versionNumber) && versionNumber > 0
                ? await getVersionData(tenantId, slug, versionNumber)
                : null;

            const rawSource = (versionData?.source ?? manifest.source) as unknown;
            const source: GenerationSource =
              rawSource === "scratch" || rawSource === "url"
                ? rawSource
                : manifest.url
                ? "url"
                : "scratch";

            const projectName =
              versionData?.title?.trim() || manifest.title?.trim() || slug;
            const keyPrefix = getProjectArtifactKeyPrefix({
              tenantId,
              slug,
              version: versionNumber,
              kind: "source",
            });
            const versionDir = `s3://${bucket}/${keyPrefix}`;
            const templates = renderProjectTemplateFiles({
              source,
              projectName,
            });

            try {
              let wroteForVersion = false;
              for (const filename of TEMPLATE_FILES) {
                const key = `${keyPrefix}/${filename}`;

                if (!overwrite) {
                  const alreadyExists = await doesObjectExist({
                    client,
                    bucket,
                    key,
                  });
                  if (alreadyExists) continue;
                }

                await client.send(
                  new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: templates[filename],
                    ContentType: "text/plain; charset=utf-8",
                  }),
                );

                wroteForVersion = true;
                written[filename] = (written[filename] ?? 0) + 1;
              }

              if (wroteForVersion) versionsTouched++;
            } catch (e) {
              errors.push({
                organizationId: tenantId,
                slug,
                versionDir,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      }

      return {
        success: true,
        tenantsScanned,
        projectsScanned,
        legacyProjectsMigrated,
        versionsScanned,
        versionsTouched,
        written,
        errors,
      };
    }),

  /**
   * Get application configuration (exposed to frontend)
   */
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const domain = process.env.DOMAIN || null;
    const organizationId = ctx.organizationId ?? getActiveTenantId();
    const org = ctx.organizationId
      ? await db.query.organization.findFirst({
          where: eq(organization.id, ctx.organizationId),
          columns: { githubRepoPrefix: true },
        })
      : null;
    return {
      // The current domain where vivd-studio is running
      domain,
      tenantId: organizationId,
      github: {
        enabled: process.env.GITHUB_SYNC_ENABLED === "true",
        org: process.env.GITHUB_ORG || null,
        repoPrefix:
          org?.githubRepoPrefix ?? process.env.GITHUB_REPO_PREFIX ?? "",
      },
    };
  }),

  /**
   * Admin maintenance: upload all local project versions into object storage (S3/R2)
   * so studio machines can hydrate workspaces from the bucket.
   */
  exportAllProjectsToObjectStorage: ownerProcedure.mutation(async () => {
    const { bucket, endpointUrl, region, accessKeyId, secretAccessKey, sessionToken } =
      getObjectStorageConfigFromEnv();
    const client = createS3Client({
      bucket,
      endpointUrl,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });

    const tenantId = getActiveTenantId();

    const projectDirs = await listProjectSlugs(tenantId);
    if (projectDirs.length === 0) {
      return {
        success: true,
        bucket,
        endpointUrl: endpointUrl || null,
        tenantId,
        projectsScanned: 0,
        legacyProjectsMigrated: 0,
        versionsScanned: 0,
        versionsExported: 0,
        filesUploaded: 0,
        bytesUploaded: 0,
        errors: [] as Array<{
          slug: string;
          versionDir: string;
          error: string;
        }>,
        fileErrors: [] as Array<{
          slug: string;
          versionDir: string;
          file: string;
          key: string;
          error: string;
        }>,
      };
    }

    let projectsScanned = 0;
    let legacyProjectsMigrated = 0;
    let versionsScanned = 0;
    let versionsExported = 0;
    let filesUploaded = 0;
    let bytesUploaded = 0;

    const errors: Array<{ slug: string; versionDir: string; error: string }> =
      [];
    const fileErrors: Array<{
      slug: string;
      versionDir: string;
      file: string;
      key: string;
      error: string;
    }> = [];

    for (const slug of projectDirs) {
      projectsScanned++;

      try {
        if (isLegacyProject(slug)) {
          const did = migrateProjectIfNeeded(slug);
          if (did) legacyProjectsMigrated++;
        }
      } catch (e) {
        errors.push({
          slug,
          versionDir: getProjectDir(tenantId, slug),
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const projectDir = getProjectDir(tenantId, slug);
      if (!fs.existsSync(projectDir)) continue;

      // Keep behavior consistent with other migrations: only process projects with a manifest.
      const manifest = await getManifest(tenantId, slug);
      if (!manifest) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        versionsScanned++;

        if (!fs.existsSync(versionDir)) continue;

        const keyPrefix = `tenants/${tenantId}/projects/${slug}/${folder}/source`;

        try {
          const res = await uploadDirectoryToBucket({
            client,
            bucket,
            localDir: versionDir,
            keyPrefix,
            excludeDirNames: ["node_modules"],
          });

          versionsExported++;
          filesUploaded += res.filesUploaded;
          bytesUploaded += res.bytesUploaded;

          for (const fe of res.errors) {
            fileErrors.push({
              slug,
              versionDir,
              file: fe.file,
              key: fe.key,
              error: fe.error,
            });
          }
        } catch (e) {
          errors.push({
            slug,
            versionDir,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      success: true,
      bucket,
      endpointUrl: endpointUrl || null,
      tenantId,
      projectsScanned,
      legacyProjectsMigrated,
      versionsScanned,
      versionsExported,
      filesUploaded,
      bytesUploaded,
      errors,
      fileErrors,
    };
  }),

  /**
   * Delete a project permanently.
   * Requires typing the project name to confirm deletion (GitHub-style safety).
   */
  delete: adminProcedure
    .input(
      z.object({
        slug: z.string(),
        confirmationText: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, confirmationText } = input;

      // Safety check: confirmation text must match the project slug
      if (confirmationText !== slug) {
        throw new Error(
          "Confirmation text does not match the project name. Deletion aborted."
        );
      }

      const manifest = await getManifest(organizationId, slug);
      if (!manifest) throw new Error("Project not found");

      // Check if project is published - cannot delete published projects
      const publishInfo = await publishService.getPublishedInfo(organizationId, slug);
      if (publishInfo) {
        throw new Error(
          `Cannot delete a published project. Please unpublish "${publishInfo.domain}" first.`
        );
      }

      const projectDir = getProjectDir(organizationId, slug);
      const legacyProjectDir = path.join(getProjectsRootDir(), slug);
      const tenantProjectDir = path.join(getTenantProjectsDir(organizationId), slug);
      const projectDirPrefixes = Array.from(
        new Set([projectDir, legacyProjectDir, tenantProjectDir]),
      );

      if (isManagedStudioMachineProvider(studioMachineProvider)) {
        await cleanupManagedStudioMachinesForDeletedProject({
          provider: studioMachineProvider,
          organizationId,
          slug,
          logPrefix: "Delete",
        });
      } else {
        // Stop any running local studio machines for this project (all versions).
        // Managed providers destroy matching machines entirely above.
        for (const v of manifest.versions) {
          try {
            await studioMachineProvider.stop(organizationId, slug, v.version);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(
              `[Delete] Failed to stop studio for ${slug}/v${v.version}: ${message}`,
            );
          }
        }
      }

      // Delete DB records (DB is source of truth for project listing).
      await db.transaction(async (tx) => {
        await tx
          .delete(projectMember)
          .where(
            and(
              eq(projectMember.organizationId, organizationId),
              eq(projectMember.projectSlug, slug),
            ),
          );
        await tx
          .delete(projectMeta)
          .where(and(eq(projectMeta.organizationId, organizationId), eq(projectMeta.slug, slug)));
        await tx
          .delete(publishedSite)
          .where(
            and(
              eq(publishedSite.organizationId, organizationId),
              eq(publishedSite.projectSlug, slug),
            ),
          );
      });
      console.log(`[Delete] Removed DB records for: ${slug}`);

      // Delete the project directory (best-effort; project could be bucket-backed).
      for (const dir of projectDirPrefixes) {
        if (!fs.existsSync(dir)) continue;
        fs.rmSync(dir, { recursive: true, force: true });
      }
      console.log(`[Delete] Permanently deleted project files: ${slug}`);

      let bucketCleanup: {
        attempted: boolean;
        objectsDeleted?: number;
        error?: string;
      } | null = null;

      try {
        const res = await deleteProjectArtifactsFromBucket({ organizationId, slug });
        bucketCleanup = res.deleted
          ? { attempted: true, objectsDeleted: res.objectsDeleted }
          : { attempted: false };
        if (res.deleted) {
          console.log(
            `[Delete] Deleted ${res.objectsDeleted} object(s) from bucket for: ${slug}`,
          );
        }
      } catch (e) {
        bucketCleanup = {
          attempted: true,
          error: e instanceof Error ? e.message : String(e),
        };
        console.warn(
          `[Delete] Bucket cleanup failed for ${slug}: ${bucketCleanup.error}`,
        );
      }

      return {
        success: true,
        slug,
        bucketCleanup,
        message: `Project "${slug}" has been permanently deleted.`,
      };
    }),

  /**
   * Delete a specific version of a project.
   * Requires typing "v{N}" to confirm deletion.
   * Cannot delete published versions or the only remaining version.
   */
  deleteVersion: adminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        confirmationText: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version, confirmationText } = input;

      // Safety check: confirmation text must match "v{N}"
      const expectedConfirmation = `v${version}`;
      if (confirmationText !== expectedConfirmation) {
        throw new Error(
          `Confirmation text must be "${expectedConfirmation}". Deletion aborted.`
        );
      }

      const manifest = await getManifest(organizationId, slug);
      if (!manifest) throw new Error("Project not found");

      const versionExists = manifest.versions.some((v) => v.version === version);
      if (!versionExists) throw new Error(`Version ${version} not found`);

      // Check if this version is published
      const publishedVersions = await db
        .select()
        .from(publishedSite)
        .where(
          and(
            eq(publishedSite.organizationId, organizationId),
            eq(publishedSite.projectSlug, slug),
            eq(publishedSite.projectVersion, version)
          )
        )
        .limit(1);

      if (publishedVersions.length > 0) {
        throw new Error(
          `Cannot delete version ${version} because it is currently published to "${publishedVersions[0].domain}". Please unpublish first.`
        );
      }

      // Check if this is the only version
      if (manifest.versions.length <= 1) {
        throw new Error(
          "Cannot delete the only remaining version. Delete the entire project instead."
        );
      }

      if (isManagedStudioMachineProvider(studioMachineProvider)) {
        await cleanupManagedStudioMachinesForDeletedProject({
          provider: studioMachineProvider,
          organizationId,
          slug,
          version,
          logPrefix: "DeleteVersion",
        });
      } else {
        // Stop any running local studio machine for this version.
        try {
          await studioMachineProvider.stop(organizationId, slug, version);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[DeleteVersion] Failed to stop studio for ${slug}/v${version}: ${message}`,
          );
        }
      }

      // Delete the version using the utility function
      await deleteVersionUtil(organizationId, slug, version);
      console.log(`[DeleteVersion] Permanently deleted version: ${slug}/v${version}`);

      let bucketCleanup: {
        attempted: boolean;
        objectsDeleted?: number;
        error?: string;
      } | null = null;

      try {
        const res = await deleteProjectVersionArtifactsFromBucket({
          organizationId,
          slug,
          version,
        });
        bucketCleanup = res.deleted
          ? { attempted: true, objectsDeleted: res.objectsDeleted }
          : { attempted: false };
        if (res.deleted) {
          console.log(
            `[DeleteVersion] Deleted ${res.objectsDeleted} object(s) from bucket for: ${slug}/v${version}`,
          );
        }
      } catch (e) {
        bucketCleanup = {
          attempted: true,
          error: e instanceof Error ? e.message : String(e),
        };
        console.warn(
          `[DeleteVersion] Bucket cleanup failed for ${slug}/v${version}: ${bucketCleanup.error}`,
        );
      }

      return {
        success: true,
        slug,
        version,
        bucketCleanup,
        message: `Version ${version} of "${slug}" has been permanently deleted.`,
      };
    }),

  /**
   * Untrack build cache directories that should be gitignored.
   * This fixes the issue where .astro/ or other cache dirs were committed
   * before being added to .gitignore.
   */
  fixGitignore: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(ctx.organizationId!, slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      // Import gitService dynamically to avoid circular deps
      const { gitService } = await import("../../services/integrations/GitService");

      // Paths that should be ignored but might have been committed
      const pathsToUntrack = [
        ".astro",
        "node_modules",
        "dist",
        ".next",
        ".nuxt",
        ".output",
      ];

      // Untrack any that are currently tracked
      const result = await gitService.untrackIgnoredPaths(
        versionDir,
        pathsToUntrack
      );

      // If we untracked anything, commit the change
      if (result.untracked.length > 0) {
        await gitService.save(
          versionDir,
          `chore: untrack ${result.untracked.join(", ")} (now in .gitignore)`
        );
      }

      return {
        success: true,
        untracked: result.untracked,
        alreadyUntracked: result.alreadyUntracked,
        message:
          result.untracked.length > 0
            ? `Untracked and committed: ${result.untracked.join(", ")}`
            : "All paths were already untracked",
      };
    }),

  /**
   * Admin maintenance: fix gitignore for all projects.
   * Untracks build cache directories (.astro, node_modules, etc.) that were
   * accidentally committed before being added to .gitignore.
   */
  fixGitignoreAll: orgAdminProcedure.mutation(async ({ ctx }) => {
    const organizationId = ctx.organizationId ?? "default";
    const projectDirs = await listProjectSlugs(organizationId);
    if (projectDirs.length === 0) {
      return {
        success: true,
        projectsScanned: 0,
        versionsScanned: 0,
        versionsFixed: 0,
        totalUntracked: [] as string[],
        errors: [] as Array<{ slug: string; version: number; error: string }>,
      };
    }

    // Import gitService dynamically to avoid circular deps
    const { gitService } = await import("../../services/integrations/GitService");

    // Paths that should be ignored but might have been committed
    const pathsToUntrack = [
      ".astro",
      "node_modules",
      "dist",
      ".next",
      ".nuxt",
      ".output",
    ];

    let projectsScanned = 0;
    let versionsScanned = 0;
    let versionsFixed = 0;
    const allUntracked: string[] = [];
    const errors: Array<{ slug: string; version: number; error: string }> = [];

    for (const slug of projectDirs) {
      projectsScanned++;

      const manifest = await getManifest(organizationId, slug);
      if (!manifest) continue;

      const projectDir = getProjectDir(organizationId, slug);
      if (!fs.existsSync(projectDir)) continue;

      const versionFolders = fs
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
        .map((d) => d.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        const versionNumber = Number(folder.slice(1));
        versionsScanned++;

        try {
          const result = await gitService.untrackIgnoredPaths(
            versionDir,
            pathsToUntrack
          );

          if (result.untracked.length > 0) {
            await gitService.save(
              versionDir,
              `chore: untrack ${result.untracked.join(", ")} (now in .gitignore)`
            );
            versionsFixed++;
            allUntracked.push(...result.untracked);
          }
        } catch (e) {
          errors.push({
            slug,
            version: versionNumber,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return {
      success: true,
      projectsScanned,
      versionsScanned,
      versionsFixed,
      totalUntracked: [...new Set(allUntracked)], // unique paths
      errors,
    };
  }),

  /**
   * Regenerate a thumbnail for a single project version.
   * Only completed versions are supported.
   */
  regenerateThumbnail: projectMemberProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        version: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version } = input;

      const manifest = await getManifest(organizationId, slug);
      if (!manifest) {
        throw new Error("Project not found");
      }

      const versionRecord = await projectMetaService.getProjectVersion(
        organizationId,
        slug,
        version,
      );
      if (!versionRecord) {
        throw new Error(`Version ${version} does not exist for this project`);
      }
      if (versionRecord.status !== "completed") {
        throw new Error(
          "Thumbnail regeneration is only available for completed versions",
        );
      }

      const versionDir = getVersionDir(organizationId, slug, version);
      await thumbnailService.generateThumbnailImmediate(
        fs.existsSync(versionDir) ? versionDir : null,
        organizationId,
        slug,
        version,
      );

      return {
        success: true,
        slug,
        version,
        message: `Thumbnail regenerated for ${slug} v${version}`,
      };
    }),

  /**
   * Admin maintenance: regenerate thumbnails for all completed project versions.
   * Processes versions sequentially to avoid overwhelming the scraper service.
   * Only regenerates for versions with status "completed".
   */
  regenerateAllThumbnails: orgAdminProcedure
    .input(
      z
        .object({
          // If true, only regenerate missing thumbnails. If false, regenerate all.
          onlyMissing: z.boolean().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId ?? "default";
      const onlyMissing = input?.onlyMissing ?? true;
      if (!onlyMissing) {
        throw new Error(
          "Full thumbnail regeneration is disabled to limit compute usage"
        );
      }
      const thumbnailStorage = (() => {
        try {
          const config = getObjectStorageConfigFromEnv();
          return {
            client: createS3Client(config),
            bucket: config.bucket,
          };
        } catch {
          return null;
        }
      })();

      const hasExistingThumbnail = async (options: {
        thumbnailKey?: string | null;
        versionDir: string;
      }): Promise<boolean> => {
        if (thumbnailStorage) {
          if (!options.thumbnailKey) return false;
          return doesObjectExist({
            client: thumbnailStorage.client,
            bucket: thumbnailStorage.bucket,
            key: options.thumbnailKey,
          });
        }

        const thumbnailPath = getVivdInternalFilesPath(
          options.versionDir,
          "thumbnail.webp",
        );
        return fs.existsSync(thumbnailPath);
      };

      const projectDirs = await listProjectSlugs(organizationId);
      if (projectDirs.length === 0) {
        return {
          success: true,
          projectsScanned: 0,
          versionsScanned: 0,
          thumbnailsGenerated: 0,
          thumbnailsSkipped: 0,
          errors: [] as Array<{ slug: string; version: number; error: string }>,
        };
      }

      let projectsScanned = 0;
      let versionsScanned = 0;
      let thumbnailsGenerated = 0;
      let thumbnailsSkipped = 0;
      const errors: Array<{ slug: string; version: number; error: string }> = [];

      for (const slug of projectDirs) {
        projectsScanned++;
        const versionRecords = await projectMetaService.listProjectVersions(organizationId, slug);
        for (const versionRecord of versionRecords) {
          const versionNumber = versionRecord.version;
          if (!Number.isFinite(versionNumber) || versionNumber <= 0) {
            continue;
          }
          versionsScanned++;
          const versionDir = getVersionDir(organizationId, slug, versionNumber);

          // Only generate thumbnails for completed versions
          if (versionRecord.status !== "completed") {
            thumbnailsSkipped++;
            continue;
          }

          // Check if thumbnail already exists (when onlyMissing is true)
          if (onlyMissing) {
            const exists = await hasExistingThumbnail({
              thumbnailKey: versionRecord.thumbnailKey,
              versionDir,
            });
            if (exists) {
              thumbnailsSkipped++;
              continue;
            }
          }

          try {
            // Use immediate generation (no debouncing) for batch operations
            await thumbnailService.generateThumbnailImmediate(
              fs.existsSync(versionDir) ? versionDir : null,
              organizationId,
              slug,
              versionNumber,
            );
            thumbnailsGenerated++;
            console.log(
              `[Thumbnail] Regenerated ${slug} v${versionNumber} (${thumbnailsGenerated} done)`,
            );
          } catch (e) {
            errors.push({
              slug,
              version: versionNumber,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      return {
        success: true,
        projectsScanned,
        versionsScanned,
        thumbnailsGenerated,
        thumbnailsSkipped,
        errors,
      };
    }),
};
