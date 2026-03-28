import { z } from "zod";
import { createStudioBootstrapToken } from "@vivd/shared/studio";
import { projectMemberProcedure } from "../../trpc";
import { studioMachineProvider } from "../../services/studioMachines";
import { recordStudioVisit } from "../../services/studioMachines/visitStore";
import { createStudioUserActionToken } from "../../lib/studioUserActionToken";
import { resolveStableStudioMachineEnv } from "../../services/studioMachines/stableRuntimeEnv";

function createStudioRuntimeBootstrapToken(options: {
  studioId: string;
  accessToken?: string | null;
}): string | null {
  const accessToken = options.accessToken?.trim();
  if (!accessToken) return null;

  return createStudioBootstrapToken({
    accessToken,
    studioId: options.studioId,
  });
}

function createStudioRuntimeUserActionToken(options: {
  session: {
    session: {
      id: string;
      userId: string;
      expiresAt: Date;
    };
  };
  organizationId: string;
  projectSlug: string;
  version: number;
}): string {
  return createStudioUserActionToken({
    sessionId: options.session.session.id,
    userId: options.session.session.userId,
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    version: options.version,
    sessionExpiresAt: options.session.session.expiresAt,
  });
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
      const existing = await studioMachineProvider.getUrl(
        organizationId,
        input.slug,
        input.version,
      );
      if (existing) {
        return {
          url: existing.url,
          bootstrapToken: createStudioRuntimeBootstrapToken({
            studioId: existing.studioId,
            accessToken: existing.accessToken || null,
          }),
          userActionToken: createStudioRuntimeUserActionToken({
            session: ctx.session,
            organizationId,
            projectSlug: input.slug,
            version: input.version,
          }),
          status: "running" as const,
        };
      }

      // For now, return null - studio needs to be started explicitly
      return {
        url: null,
        bootstrapToken: null,
        userActionToken: null,
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
      const studioRuntimeEnv = await resolveStableStudioMachineEnv({
        providerKind: studioMachineProvider.kind,
        organizationId,
        projectSlug: input.slug,
        requestHost: ctx.requestHost,
      });

      try {
        const { studioId, url, port, accessToken } =
          await studioMachineProvider.ensureRunning({
            organizationId,
            projectSlug: input.slug,
            version: input.version,
            env: studioRuntimeEnv,
          });
        try {
          await recordStudioVisit({
            organizationId,
            projectSlug: input.slug,
            version: input.version,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[StudioMachine] Failed to persist visit for ${organizationId}:${input.slug}/v${input.version}: ${message}`,
          );
        }

        return {
          success: true as const,
          url,
          port,
          studioId,
          bootstrapToken: createStudioRuntimeBootstrapToken({
            studioId,
            accessToken: accessToken || null,
          }),
          userActionToken: createStudioRuntimeUserActionToken({
            session: ctx.session,
            organizationId,
            projectSlug: input.slug,
            version: input.version,
          }),
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
      const studioRuntimeEnv = await resolveStableStudioMachineEnv({
        providerKind: studioMachineProvider.kind,
        organizationId,
        projectSlug: input.slug,
        requestHost: ctx.requestHost,
      });

      try {
        const { studioId, url, port, accessToken } =
          await studioMachineProvider.restart({
            organizationId,
            projectSlug: input.slug,
            version: input.version,
            mode: "hard",
            env: studioRuntimeEnv,
          });
        try {
          await recordStudioVisit({
            organizationId,
            projectSlug: input.slug,
            version: input.version,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[StudioMachine] Failed to persist visit for ${organizationId}:${input.slug}/v${input.version}: ${message}`,
          );
        }

        return {
          success: true as const,
          url,
          port,
          studioId,
          bootstrapToken: createStudioRuntimeBootstrapToken({
            studioId,
            accessToken: accessToken || null,
          }),
          userActionToken: createStudioRuntimeUserActionToken({
            session: ctx.session,
            organizationId,
            projectSlug: input.slug,
            version: input.version,
          }),
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
      try {
        await recordStudioVisit({
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          version: input.version,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[StudioMachine] Failed to persist visit for ${ctx.organizationId!}:${input.slug}/v${input.version}: ${message}`,
        );
      }
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
      const info = await studioMachineProvider.getUrl(
        ctx.organizationId!,
        input.slug,
        input.version,
      );
      return {
        running,
        url: info?.url || null,
        bootstrapToken:
          info?.studioId && info?.accessToken
            ? createStudioRuntimeBootstrapToken({
                studioId: info.studioId,
                accessToken: info.accessToken,
              })
            : null,
        userActionToken:
          info?.studioId && info?.accessToken
            ? createStudioRuntimeUserActionToken({
                session: ctx.session,
                organizationId: ctx.organizationId!,
                projectSlug: input.slug,
                version: input.version,
              })
            : null,
      };
    }),
};
