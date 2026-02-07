import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { studioMachineProvider } from "../../services/studioMachines";
import { db } from "../../db";
import { session as sessionTable } from "../../db/schema";
import { eq } from "drizzle-orm";

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
      const existingUrl = await studioMachineProvider.getUrl(
        input.slug,
        input.version,
      );
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
      const backendOrigin =
        process.env.BACKEND_URL ||
        process.env.BETTER_AUTH_URL ||
        "http://localhost:3000";

      const mainBackendUrl = new URL("/vivd-studio", backendOrigin).toString().replace(/\/$/, "");

      // Resolve the user's session token for machine-to-backend authentication.
      // The auth session shape we expose to the app does not include the raw token.
      const sessionId = ctx.session.session.id;
      const sessionRecord = await db.query.session.findFirst({
        where: eq(sessionTable.id, sessionId),
      });
      const sessionToken = sessionRecord?.token;
      if (!sessionToken) {
        return {
          success: false as const,
          error: "Failed to resolve session token for studio authentication",
        };
      }

      try {
        const { studioId, url, port } = await studioMachineProvider.ensureRunning({
          projectSlug: input.slug,
          version: input.version,
          env: {
            MAIN_BACKEND_URL: mainBackendUrl,
            SESSION_TOKEN: sessionToken,
          },
        });

        return {
          success: true as const,
          url,
          port,
          studioId,
          provider: studioMachineProvider.kind,
        };
      } catch (error) {
        return {
          success: false as const,
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
      await studioMachineProvider.stop(input.slug, input.version);
      return { success: true };
    }),

  /**
   * Keep a studio instance alive while the editor UI is open.
   */
  touchStudio: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await studioMachineProvider.touch(input.slug, input.version);
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
      const running = await studioMachineProvider.isRunning(
        input.slug,
        input.version,
      );
      const url = await studioMachineProvider.getUrl(input.slug, input.version);
      return {
        running,
        url,
      };
    }),
};
