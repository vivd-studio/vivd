import fs from "fs";
import { z } from "zod";
import { orgAdminProcedure, projectMemberProcedure } from "../../../trpc";
import { getVersionDir, listProjectSlugs, getManifest } from "../../../generator/versionUtils";
import { getVivdInternalFilesPath } from "../../../generator/vivdPaths";
import { thumbnailService } from "../../../services/project/ThumbnailService";
import { projectMetaService } from "../../../services/project/ProjectMetaService";
import {
  createS3Client,
  doesObjectExist,
  getObjectStorageConfigFromEnv,
} from "../../../services/storage/ObjectStorageService";

function getThumbnailStorage() {
  try {
    const config = getObjectStorageConfigFromEnv();
    return {
      client: createS3Client(config),
      bucket: config.bucket,
    };
  } catch {
    return null;
  }
}

async function hasExistingThumbnail(options: {
  thumbnailKey?: string | null;
  versionDir: string;
  thumbnailStorage: ReturnType<typeof getThumbnailStorage>;
}): Promise<boolean> {
  if (options.thumbnailStorage) {
    if (!options.thumbnailKey) return false;
    return doesObjectExist({
      client: options.thumbnailStorage.client,
      bucket: options.thumbnailStorage.bucket,
      key: options.thumbnailKey,
    });
  }

  const thumbnailPath = getVivdInternalFilesPath(
    options.versionDir,
    "thumbnail.webp",
  );
  return fs.existsSync(thumbnailPath);
}

export const projectMaintenanceThumbnailProcedures = {
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
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId ?? "default";
      const onlyMissing = input?.onlyMissing ?? true;
      if (!onlyMissing) {
        throw new Error(
          "Full thumbnail regeneration is disabled to limit compute usage",
        );
      }
      const thumbnailStorage = getThumbnailStorage();

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
        const versionRecords = await projectMetaService.listProjectVersions(
          organizationId,
          slug,
        );
        for (const versionRecord of versionRecords) {
          const versionNumber = versionRecord.version;
          if (!Number.isFinite(versionNumber) || versionNumber <= 0) {
            continue;
          }
          versionsScanned++;
          const versionDir = getVersionDir(organizationId, slug, versionNumber);

          if (versionRecord.status !== "completed") {
            thumbnailsSkipped++;
            continue;
          }

          if (onlyMissing) {
            const exists = await hasExistingThumbnail({
              thumbnailKey: versionRecord.thumbnailKey,
              versionDir,
              thumbnailStorage,
            });
            if (exists) {
              thumbnailsSkipped++;
              continue;
            }
          }

          try {
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
