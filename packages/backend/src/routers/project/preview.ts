import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getActiveTenantId, getVersionDir } from "../../generator/versionUtils";
import { buildService } from "../../services/BuildService";
import type { S3Client } from "@aws-sdk/client-s3";
import { createS3Client, doesObjectExist, getObjectStorageConfigFromEnv } from "../../services/ObjectStorageService";
import { getProjectArtifactKeyPrefix } from "../../services/ProjectStoragePaths";
import { detectProjectType } from "../../devserver/projectType";
import fs from "node:fs";

export const previewProcedures = {
  /**
   * Get the external preview status and URL for a project version.
   * Returns build status for Astro projects, or ready for static projects.
   * Always returns the /preview/ URL for external sharing.
   */
  getExternalPreviewStatus: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input }) => {
      const { slug, version } = input;

      // External preview URL is always /preview/ (static serving)
      const url = `/vivd-studio/api/preview/${slug}/v${version}/`;

      // Prefer bucket-backed preview readiness when object storage is configured.
      // Fallback to local build artifacts for dev/self-hosted modes.
      let storage: { client: S3Client; bucket: string } | null = null;
      try {
        const s3Config = getObjectStorageConfigFromEnv(process.env);
        storage = { client: createS3Client(s3Config), bucket: s3Config.bucket };
      } catch {
        storage = null;
      }

      if (storage) {
        const previewPrefix = getProjectArtifactKeyPrefix({
          tenantId: getActiveTenantId(),
          slug,
          version,
          kind: "preview",
        });
        const hasPreview = await doesObjectExist({
          client: storage.client,
          bucket: storage.bucket,
          key: `${previewPrefix}/index.html`,
        });
        if (hasPreview) {
          return {
            mode: "built" as const,
            status: "ready" as const,
            url,
          };
        }

        const sourcePrefix = getProjectArtifactKeyPrefix({
          tenantId: getActiveTenantId(),
          slug,
          version,
          kind: "source",
        });
        const hasSourceIndex = await doesObjectExist({
          client: storage.client,
          bucket: storage.bucket,
          key: `${sourcePrefix}/index.html`,
        });
        if (hasSourceIndex) {
          return {
            mode: "static" as const,
            status: "ready" as const,
            url,
          };
        }

        return {
          mode: "built" as const,
          status: "pending" as const,
          url,
        };
      }

      const versionDir = getVersionDir(slug, version);
      const config = fs.existsSync(versionDir)
        ? detectProjectType(versionDir)
        : { framework: "generic" as const, mode: "static" as const, packageManager: "npm" as const };

      if (config.framework !== "astro") {
        return {
          mode: "static" as const,
          status: "ready" as const,
          url,
        };
      }

      // Check if build exists (in memory or on disk via getBuildPath)
      const buildPath = buildService.getBuildPath(versionDir);
      if (buildPath) {
        return {
          mode: "built" as const,
          status: "ready" as const,
          url,
        };
      }

      const buildStatus = buildService.getBuildStatus(versionDir);
      return {
        mode: "built" as const,
        status: buildStatus?.status || ("pending" as const),
        url,
        error: buildStatus?.error,
      };
    }),
};
