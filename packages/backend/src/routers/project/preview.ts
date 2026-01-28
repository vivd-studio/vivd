import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getVersionDir } from "../../generator/versionUtils";
import { devServerManager, detectProjectType } from "../../devserver";
import { buildService } from "../../services/BuildService";
import { serverManager as opencodeServerManager } from "../../opencode/serverManager";

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
