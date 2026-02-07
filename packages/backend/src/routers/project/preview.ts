import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getActiveTenantId, getVersionDir } from "../../generator/versionUtils";
import { devServerManager, detectProjectType } from "../../devserver";
import { buildService } from "../../services/BuildService";
import { serverManager as opencodeServerManager } from "../../opencode/serverManager";
import type { S3Client } from "@aws-sdk/client-s3";
import { createS3Client, doesObjectExist, getObjectStorageConfigFromEnv } from "../../services/ObjectStorageService";
import { getProjectArtifactKeyPrefix } from "../../services/ProjectStoragePaths";

export const previewProcedures = {
  /**
   * Get preview URL and mode for a project version.
   * Starts dev server if needed.
   */
  getPreviewInfo: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);
      const config = detectProjectType(versionDir);

      if (config.mode === "static") {
        return {
          mode: "static" as const,
          status: "ready" as const,
          url: `/vivd-studio/api/preview/${slug}/v${version}/index.html`,
        };
      }

      // Dev server mode - start if needed
      // Pass the base path so assets are served correctly
      const basePath = `/vivd-studio/api/devpreview/${slug}/v${version}`;
      const result = await devServerManager.getOrStartDevServer(
        versionDir,
        basePath,
      );

      return {
        mode: "devserver" as const,
        status: result.status,
        // Proxy URL - frontend always uses this path, backend proxies to actual dev server
        url: `${basePath}/`,
        error: result.error,
      };
    }),

  /**
   * Stop a dev server for a project version.
   */
  stopDevServer: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      devServerManager.stopDevServer(versionDir);

      return { success: true };
    }),

  /**
   * Stop an opencode server for a project version.
   */
  stopOpencodeServer: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);
      await opencodeServerManager.stopServer(versionDir);
      console.log(`[Preview] Stopped opencode server for ${slug}/v${version}`);
      return { success: true };
    }),

  /**
   * Keep the dev server alive by updating its last activity time.
   * Called periodically by the frontend while the preview is open.
   */
  keepAliveDevServer: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);
      devServerManager.touchProject(versionDir);
      return { success: true };
    }),

  /**
   * Get the current status of a dev server.
   */
  getDevServerStatus: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      }),
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      return {
        status: devServerManager.getDevServerStatus(versionDir),
      };
    }),

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
      const versionDir = getVersionDir(slug, version);
      const config = detectProjectType(versionDir);

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

      if (config.framework !== "astro") {
        if (storage) {
          const keyPrefix = getProjectArtifactKeyPrefix({
            tenantId: getActiveTenantId(),
            slug,
            version,
            kind: "source",
          });
          const exists = await doesObjectExist({
            client: storage.client,
            bucket: storage.bucket,
            key: `${keyPrefix}/index.html`,
          });
          if (exists) {
            return {
              mode: "static" as const,
              status: "ready" as const,
              url,
            };
          }
        }

        return {
          mode: "static" as const,
          status: "ready" as const,
          url,
        };
      }

      if (storage) {
        const keyPrefix = getProjectArtifactKeyPrefix({
          tenantId: getActiveTenantId(),
          slug,
          version,
          kind: "preview",
        });
        const exists = await doesObjectExist({
          client: storage.client,
          bucket: storage.bucket,
          key: `${keyPrefix}/index.html`,
        });
        if (exists) {
          return {
            mode: "built" as const,
            status: "ready" as const,
            url,
          };
        }
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
