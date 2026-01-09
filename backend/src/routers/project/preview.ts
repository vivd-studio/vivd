import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getVersionDir } from "../../generator/versionUtils";
import { devServerManager, detectProjectType } from "../../devserver";

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
      })
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
        basePath
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
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      devServerManager.stopDevServer(versionDir);

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
      })
    )
    .query(async ({ input }) => {
      const { slug, version } = input;
      const versionDir = getVersionDir(slug, version);

      return {
        status: devServerManager.getDevServerStatus(versionDir),
      };
    }),
};
