/**
 * Studio API Router
 *
 * Handles communication between connected studio instances and the main backend.
 * Studio instances authenticate using the user's session token (same as other protected routes).
 */

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { usageService, type TokenData } from "../services/UsageService";
import { limitsService } from "../services/LimitsService";

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
});
