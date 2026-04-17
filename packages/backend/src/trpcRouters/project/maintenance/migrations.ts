import fs from "fs";
import path from "path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import {
  orgAdminProcedure,
  ownerProcedure,
  projectMemberProcedure,
} from "../../../trpc";
import { db } from "../../../db";
import { organization } from "../../../db/schema";
import type { GenerationSource } from "../../../generator/flows/types";
import {
  renderProjectTemplateFiles,
  TEMPLATE_FILES,
} from "../../../generator/templateFiles";
import {
  getManifest,
  getProjectDir,
  getVersionData,
  getVersionDir,
  isLegacyProject,
  listProjectSlugs,
  migrateProjectIfNeeded,
} from "../../../generator/versionUtils";
import {
  migrateVivdInternalArtifactsInVersion,
  VIVD_INTERNAL_ARTIFACT_FILENAMES,
} from "../../../generator/vivdPaths";
import { migrateProjectMetadataToDbFromFilesystem } from "../../../services/project/ProjectMetaMigrationService";
import { getProjectArtifactKeyPrefix } from "../../../services/project/ProjectStoragePaths";
import {
  createS3Client,
  doesObjectExist,
  getObjectStorageConfigFromEnv,
} from "../../../services/storage/ObjectStorageService";
import {
  BUILD_CACHE_PATHS_TO_UNTRACK,
  loadGitService,
} from "./shared";

function createVivdArtifactCounter(): Record<string, number> {
  return Object.fromEntries(
    VIVD_INTERNAL_ARTIFACT_FILENAMES.map((filename) => [filename, 0]),
  );
}

export const projectMaintenanceMigrationProcedures = {
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
        moved: createVivdArtifactCounter(),
        movedToLegacy: createVivdArtifactCounter(),
        errors: [] as Array<{
          slug: string;
          versionDir: string;
          error: string;
        }>,
      };
    }

    const moved = createVivdArtifactCounter();
    const movedToLegacy = createVivdArtifactCounter();

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
        .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
        .map((entry) => entry.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        versionsScanned++;

        try {
          const result = migrateVivdInternalArtifactsInVersion(versionDir);
          if (result.moved.length || result.movedToLegacy.length) {
            versionsTouched++;
          }
          for (const item of result.moved) moved[item.filename]++;
          for (const item of result.movedToLegacy) movedToLegacy[item.filename]++;
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
        .optional(),
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
      const {
        bucket,
        endpointUrl,
        region,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      } = getObjectStorageConfigFromEnv();
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
   * Untrack build cache directories that should be gitignored.
   * This fixes the issue where .astro/ or other cache dirs were committed
   * before being added to .gitignore.
   */
  fixGitignore: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(ctx.organizationId!, slug, version);

      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      const gitService = await loadGitService();
      const result = await gitService.untrackIgnoredPaths(
        versionDir,
        BUILD_CACHE_PATHS_TO_UNTRACK,
      );

      if (result.untracked.length > 0) {
        await gitService.save(
          versionDir,
          `chore: untrack ${result.untracked.join(", ")} (now in .gitignore)`,
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

    const gitService = await loadGitService();

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
        .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
        .map((entry) => entry.name);

      for (const folder of versionFolders) {
        const versionDir = path.join(projectDir, folder);
        const versionNumber = Number(folder.slice(1));
        versionsScanned++;

        try {
          const result = await gitService.untrackIgnoredPaths(
            versionDir,
            BUILD_CACHE_PATHS_TO_UNTRACK,
          );

          if (result.untracked.length > 0) {
            await gitService.save(
              versionDir,
              `chore: untrack ${result.untracked.join(", ")} (now in .gitignore)`,
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
      totalUntracked: [...new Set(allUntracked)],
      errors,
    };
  }),
};
