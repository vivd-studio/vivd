import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { studioMachineProvider } from "../../services/studioMachines";
import { db } from "../../db";
import { organization, session as sessionTable } from "../../db/schema";
import { eq } from "drizzle-orm";

function normalizeGitHubRepoPrefix(value: string): string {
  const trimmed = value.trim().replace(/^-+/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("-") ? trimmed : `${trimmed}-`;
}

function buildStudioGitHubRepoPrefix(options: {
  organizationId: string;
  organizationRepoPrefix: string | null;
}): string {
  const instancePrefix = normalizeGitHubRepoPrefix(process.env.GITHUB_REPO_PREFIX || "");
  const orgPrefixRaw = (options.organizationRepoPrefix || "").trim();
  const orgPrefix = normalizeGitHubRepoPrefix(orgPrefixRaw || options.organizationId);

  if (!instancePrefix) return orgPrefix;
  if (orgPrefix.startsWith(instancePrefix)) return orgPrefix;
  if (instancePrefix.endsWith(orgPrefix)) return instancePrefix;
  return `${instancePrefix}${orgPrefix}`;
}

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
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      // Check if studio is already running
      const existingUrl = await studioMachineProvider.getUrl(
        organizationId,
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
      const organizationId = ctx.organizationId!;
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
        columns: { githubRepoPrefix: true },
      });
      const githubRepoPrefix = buildStudioGitHubRepoPrefix({
        organizationId,
        organizationRepoPrefix: org?.githubRepoPrefix ?? null,
      });
      // Studio machines need a backend URL that is reachable *from the machine*.
      // - Local provider spawns the studio as a child-process inside this backend container,
      //   so `DOMAIN` (usually `http://localhost` via Caddy on :80) is not reachable.
      // - Fly provider typically needs a public tunnel / `DOMAIN`.
      //
      // `BACKEND_URL` overrides this, and should always be the machine-reachable origin.
      const backendOriginRaw =
        process.env.BACKEND_URL ||
        (studioMachineProvider.kind === "local"
          ? `http://127.0.0.1:${process.env.PORT || 3000}`
          : process.env.DOMAIN ||
            process.env.BETTER_AUTH_URL ||
            `http://127.0.0.1:${process.env.PORT || 3000}`);
      const backendOrigin = backendOriginRaw.startsWith("http")
        ? backendOriginRaw
        : `https://${backendOriginRaw}`;
      const mainBackendUrl = new URL("/vivd-studio", backendOrigin)
        .toString()
        .replace(/\/$/, "");

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
            organizationId,
            projectSlug: input.slug,
            version: input.version,
            env: {
              MAIN_BACKEND_URL: mainBackendUrl,
              SESSION_TOKEN: sessionToken,
              GITHUB_REPO_PREFIX: githubRepoPrefix,
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
   * Hard-restart a studio instance.
   *
   * This forces a fresh boot (instead of resuming a suspended snapshot) so the
   * studio entrypoint rehydrates the workspace from object storage again.
   */
  hardRestartStudio: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const organizationId = ctx.organizationId!;
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
        columns: { githubRepoPrefix: true },
      });
      const githubRepoPrefix = buildStudioGitHubRepoPrefix({
        organizationId,
        organizationRepoPrefix: org?.githubRepoPrefix ?? null,
      });

      const backendOriginRaw =
        process.env.BACKEND_URL ||
        (studioMachineProvider.kind === "local"
          ? `http://127.0.0.1:${process.env.PORT || 3000}`
          : process.env.DOMAIN ||
            process.env.BETTER_AUTH_URL ||
            `http://127.0.0.1:${process.env.PORT || 3000}`);
      const backendOrigin = backendOriginRaw.startsWith("http")
        ? backendOriginRaw
        : `https://${backendOriginRaw}`;
      const mainBackendUrl = new URL("/vivd-studio", backendOrigin)
        .toString()
        .replace(/\/$/, "");

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
        const { studioId, url, port } = await studioMachineProvider.restart({
          organizationId,
          projectSlug: input.slug,
          version: input.version,
          mode: "hard",
          env: {
            MAIN_BACKEND_URL: mainBackendUrl,
            SESSION_TOKEN: sessionToken,
            GITHUB_REPO_PREFIX: githubRepoPrefix,
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
          error: error instanceof Error ? error.message : "Failed to restart studio",
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
    .mutation(async ({ ctx, input }) => {
      await studioMachineProvider.stop(ctx.organizationId!, input.slug, input.version);
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
    .mutation(async ({ ctx, input }) => {
      await studioMachineProvider.touch(ctx.organizationId!, input.slug, input.version);
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
    .query(async ({ ctx, input }) => {
      const running = await studioMachineProvider.isRunning(
        ctx.organizationId!,
        input.slug,
        input.version,
      );
      const url = await studioMachineProvider.getUrl(ctx.organizationId!, input.slug, input.version);
      return {
        running,
        url,
      };
    }),
};
