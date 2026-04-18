import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { projectAdminProcedure } from "../../../trpc";
import { db } from "../../../db";
import {
  projectMember,
  projectMeta,
  publishedSite,
} from "../../../db/schema";
import {
  deleteVersion as deleteVersionUtil,
  getManifest,
  getProjectDir,
  getProjectsRootDir,
  getTenantProjectsDir,
} from "../../../generator/versionUtils";
import { publishService } from "../../../services/publish/PublishService";
import {
  deleteProjectArtifactsFromBucket,
  deleteProjectVersionArtifactsFromBucket,
} from "../../../services/project/ProjectArtifactsService";
import { studioMachineProvider } from "../../../services/studioMachines";
import { cleanupManagedStudioMachinesForDeletedProject } from "../../../services/studioMachines/deleteCleanup";
import { isManagedStudioMachineProvider } from "../../../services/studioMachines/types";

async function cleanupStudioMachinesForProjectDeletion(options: {
  organizationId: string;
  slug: string;
  versions: Array<{ version: number }>;
}): Promise<void> {
  const { organizationId, slug, versions } = options;
  if (isManagedStudioMachineProvider(studioMachineProvider)) {
    await cleanupManagedStudioMachinesForDeletedProject({
      provider: studioMachineProvider,
      organizationId,
      slug,
      logPrefix: "Delete",
    });
    return;
  }

  for (const versionRecord of versions) {
    try {
      await studioMachineProvider.stop(
        organizationId,
        slug,
        versionRecord.version,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Delete] Failed to stop studio for ${slug}/v${versionRecord.version}: ${message}`,
      );
    }
  }
}

async function cleanupStudioMachineForVersionDeletion(options: {
  organizationId: string;
  slug: string;
  version: number;
}): Promise<void> {
  const { organizationId, slug, version } = options;
  if (isManagedStudioMachineProvider(studioMachineProvider)) {
    await cleanupManagedStudioMachinesForDeletedProject({
      provider: studioMachineProvider,
      organizationId,
      slug,
      version,
      logPrefix: "DeleteVersion",
    });
    return;
  }

  try {
    await studioMachineProvider.stop(organizationId, slug, version);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[DeleteVersion] Failed to stop studio for ${slug}/v${version}: ${message}`,
    );
  }
}

export const projectMaintenanceDestructiveProcedures = {
  /**
   * Delete a project permanently.
   * Requires typing the project name to confirm deletion (GitHub-style safety).
   */
  delete: projectAdminProcedure
    .input(
      z.object({
        slug: z.string(),
        confirmationText: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, confirmationText } = input;

      if (confirmationText !== slug) {
        throw new Error(
          "Confirmation text does not match the project name. Deletion aborted.",
        );
      }

      const manifest = await getManifest(organizationId, slug);
      if (!manifest) throw new Error("Project not found");

      const publishInfo = await publishService.getPublishedInfo(organizationId, slug);
      if (publishInfo) {
        throw new Error(
          `Cannot delete a published project. Please unpublish "${publishInfo.domain}" first.`,
        );
      }

      const projectDir = getProjectDir(organizationId, slug);
      const legacyProjectDir = path.join(getProjectsRootDir(), slug);
      const tenantProjectDir = path.join(getTenantProjectsDir(organizationId), slug);
      const projectDirPrefixes = Array.from(
        new Set([projectDir, legacyProjectDir, tenantProjectDir]),
      );

      await cleanupStudioMachinesForProjectDeletion({
        organizationId,
        slug,
        versions: manifest.versions,
      });

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
          .where(
            and(
              eq(projectMeta.organizationId, organizationId),
              eq(projectMeta.slug, slug),
            ),
          );
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
        const result = await deleteProjectArtifactsFromBucket({ organizationId, slug });
        bucketCleanup = result.deleted
          ? { attempted: true, objectsDeleted: result.objectsDeleted }
          : { attempted: false };
        if (result.deleted) {
          console.log(
            `[Delete] Deleted ${result.objectsDeleted} object(s) from bucket for: ${slug}`,
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
  deleteVersion: projectAdminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        confirmationText: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const { slug, version, confirmationText } = input;

      const expectedConfirmation = `v${version}`;
      if (confirmationText !== expectedConfirmation) {
        throw new Error(
          `Confirmation text must be "${expectedConfirmation}". Deletion aborted.`,
        );
      }

      const manifest = await getManifest(organizationId, slug);
      if (!manifest) throw new Error("Project not found");

      const versionExists = manifest.versions.some((entry) => entry.version === version);
      if (!versionExists) throw new Error(`Version ${version} not found`);

      const publishedVersions = await db
        .select()
        .from(publishedSite)
        .where(
          and(
            eq(publishedSite.organizationId, organizationId),
            eq(publishedSite.projectSlug, slug),
            eq(publishedSite.projectVersion, version),
          ),
        )
        .limit(1);

      if (publishedVersions.length > 0) {
        throw new Error(
          `Cannot delete version ${version} because it is currently published to "${publishedVersions[0].domain}". Please unpublish first.`,
        );
      }

      if (manifest.versions.length <= 1) {
        throw new Error(
          "Cannot delete the only remaining version. Delete the entire project instead.",
        );
      }

      await cleanupStudioMachineForVersionDeletion({
        organizationId,
        slug,
        version,
      });

      await deleteVersionUtil(organizationId, slug, version);
      console.log(`[DeleteVersion] Permanently deleted version: ${slug}/v${version}`);

      let bucketCleanup: {
        attempted: boolean;
        objectsDeleted?: number;
        error?: string;
      } | null = null;

      try {
        const result = await deleteProjectVersionArtifactsFromBucket({
          organizationId,
          slug,
          version,
        });
        bucketCleanup = result.deleted
          ? { attempted: true, objectsDeleted: result.objectsDeleted }
          : { attempted: false };
        if (result.deleted) {
          console.log(
            `[DeleteVersion] Deleted ${result.objectsDeleted} object(s) from bucket for: ${slug}/v${version}`,
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
};
