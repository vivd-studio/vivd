import path from "path";
import { randomUUID } from "node:crypto";
import { PROJECT_VERSION_MANUAL_STATUS_VALUES } from "@vivd/shared/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, orgAdminProcedure } from "../../../trpc";
import { db } from "../../../db";
import {
  pluginEntitlement,
  projectMember,
  projectMeta,
  projectPluginInstance,
  projectPublishChecklist,
  projectVersion,
  usageRecord,
} from "../../../db/schema";
import { getProjectsRootDir, getTenantProjectsDir } from "../../../generator/versionUtils";
import { publishService } from "../../../services/publish/PublishService";
import {
  copyProjectArtifactsInBucket,
  deleteProjectArtifactsFromBucket,
} from "../../../services/project/ProjectArtifactsService";
import { projectMetaService } from "../../../services/project/ProjectMetaService";
import { projectStatusOverrideService } from "../../../services/project/ProjectStatusOverrideService";
import { rewriteProjectArtifactKeyForSlug } from "../../../services/project/slugRename";
import { renamePluginProjectDataForSlugChange } from "../../../services/plugins/integrationHooks";
import { studioMachineProvider } from "../../../services/studioMachines";
import {
  moveDirectory,
  normalizeProjectSlug,
  normalizeProjectTitle,
  rewriteChecklistProjectSlug,
} from "./shared";

async function stopProjectStudiosForRename(
  organizationId: string,
  slug: string,
): Promise<void> {
  const versions = await projectMetaService.listProjectVersions(organizationId, slug);
  for (const versionRow of versions) {
    try {
      await studioMachineProvider.stop(
        organizationId,
        slug,
        versionRow.version,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[RenameSlug] Failed to stop studio for ${slug}/v${versionRow.version}: ${message}`,
      );
    }
  }
}

export const projectMaintenanceStatusAndIdentityProcedures = {
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
      }),
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

      await stopProjectStudiosForRename(organizationId, oldSlug);

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
};
