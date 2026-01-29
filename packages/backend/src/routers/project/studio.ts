import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { studioService } from "../../services/StudioService";

/**
 * Studio-related TRPC procedures.
 * These handle starting and managing studio instances for editing projects.
 */
export const studioProcedures = {
  /**
   * Get or start a studio instance for a project version.
   * Returns the studio URL if running, or starts a new instance.
   */
  getStudioUrl: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      // Check if studio is already running
      const existingUrl = studioService.getUrl(input.slug, input.version);
      if (existingUrl) {
        return {
          url: existingUrl,
          status: "running" as const,
        };
      }

      // For now, return null - studio needs to be started explicitly
      return {
        url: null,
        status: "stopped" as const,
      };
    }),

  /**
   * Start a studio instance for a project version.
   */
  startStudio: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Build the git repo URL for the project
      // The URL should point to the backend's git HTTP endpoint
      const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
      const repoUrl = `${backendUrl}/vivd-studio/api/git/${input.slug}/v${input.version}`;

      // Use the user's session token for git authentication
      // The studio will pass this as git credentials when cloning/pushing
      const sessionToken = ctx.session?.token;

      try {
        const { url, port } = await studioService.start(
          input.slug,
          input.version,
          repoUrl,
          sessionToken
        );

        return {
          success: true,
          url,
          port,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to start studio",
        };
      }
    }),

  /**
   * Stop a studio instance.
   */
  stopStudio: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      studioService.stop(input.slug, input.version);
      return { success: true };
    }),

  /**
   * Check if a studio is running.
   */
  isStudioRunning: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .query(async ({ input }) => {
      return {
        running: studioService.isRunning(input.slug, input.version),
        url: studioService.getUrl(input.slug, input.version),
      };
    }),
};
