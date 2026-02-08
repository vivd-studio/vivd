/**
 * Studio API Router
 *
 * Handles communication between connected studio instances and the main backend.
 * Studio instances authenticate using the user's session token (same as other protected routes).
 */

import { z } from "zod";
import { router, protectedProcedure, projectMemberProcedure } from "../trpc";
import { usageService, type TokenData } from "../services/UsageService";
import { limitsService } from "../services/LimitsService";
import { getVersionDir, touchProjectUpdatedAt } from "../generator/versionUtils";
import { thumbnailService } from "../services/ThumbnailService";

/**
 * Schema for token data in usage reports
 */
const tokenDataSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }),
});

/**
 * Schema for individual usage report from studio
 */
const studioUsageReportSchema = z.object({
  sessionId: z.string(),
  sessionTitle: z.string().optional(),
  cost: z.number(),
  tokens: tokenDataSchema.optional(),
  partId: z.string().optional(),
  projectPath: z.string().optional(),
  timestamp: z.string(),
});

export const studioApiRouter = router({
  /**
   * Receive usage reports from studio instances.
   * Called by studio's UsageReporter service to sync usage data.
   * Authenticated via user's session token.
   */
  reportUsage: protectedProcedure
    .input(
      z.object({
        studioId: z.string(),
        reports: z.array(studioUsageReportSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      console.log(
        `[StudioAPI] Received ${input.reports.length} usage reports from studio ${input.studioId} (user: ${userId})`
      );

      // Record each report via UsageService
      for (const report of input.reports) {
        await usageService.recordAiCost(
          report.cost,
          report.tokens as TokenData | undefined,
          report.sessionId,
          report.sessionTitle,
          report.projectPath, // Use projectPath as projectSlug for studio reports
          report.partId
        );
      }

      return { success: true, recorded: input.reports.length };
    }),

  /**
   * Update the display title for an OpenCode session after it has been renamed.
   * This allows the usage table to reflect the latest session titles even if no
   * further usage events are emitted after the rename.
   */
  updateSessionTitle: protectedProcedure
    .input(
      z.object({
        studioId: z.string(),
        sessionId: z.string(),
        sessionTitle: z.string(),
        projectSlug: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      console.log(
        `[StudioAPI] Session title update from studio ${input.studioId} (user: ${userId}): ${input.sessionId} -> "${input.sessionTitle}"`,
      );

      await usageService.updateSessionTitle(
        input.sessionId,
        input.sessionTitle,
        input.projectSlug,
      );

      return { success: true };
    }),

  /**
   * Return current usage status for a studio instance.
   * Studio calls this to get limit information for display.
   * Authenticated via user's session token.
   */
  getStatus: protectedProcedure
    .input(
      z.object({
        studioId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Return current limit status
      const status = await limitsService.checkLimits();

      console.log(
        `[StudioAPI] Status request from studio ${input.studioId} (user: ${userId}): blocked=${status.blocked}`
      );

      return status;
    }),

  /**
   * Mark a project's metadata as updated.
   * Studio instances call this after local workspace edits/snapshots so the main app
   * can sort projects by last activity.
   */
  touchProjectUpdatedAt: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      await touchProjectUpdatedAt(input.slug);
      return { success: true };
    }),

  /**
   * Request thumbnail regeneration for a project version.
   * Studio instances call this after snapshot/build artifacts have been synced so
   * the control plane can refresh project card thumbnails from the bucket-backed preview.
   */
  generateThumbnail: projectMemberProcedure
    .input(
      z.object({
        studioId: z.string(),
        slug: z.string().min(1),
        version: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input }) => {
      // Also touch project activity so list sorting updates immediately.
      void touchProjectUpdatedAt(input.slug).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[StudioAPI] touchProjectUpdatedAt failed for ${input.slug}: ${message}`,
        );
      });

      // Fire-and-forget; thumbnail generation is debounced internally.
      const versionDir = getVersionDir(input.slug, input.version);
      thumbnailService
        .generateThumbnail(versionDir, input.slug, input.version)
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[StudioAPI] Thumbnail generation failed for ${input.slug}/v${input.version}: ${message}`,
          );
        });

      return { success: true };
    }),
});
