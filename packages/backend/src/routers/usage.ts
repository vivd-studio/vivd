import { z } from "zod";
import { router, adminProcedure } from "../trpc";
import { usageService } from "../services/usage/UsageService";
import { limitsService } from "../services/usage/LimitsService";

export const usageRouter = router({
  /**
   * Get current usage status including limits and warnings
   */
  status: adminProcedure.query(async ({ ctx }) => {
    return await limitsService.checkLimits(ctx.organizationId!);
  }),

  /**
   * Get current usage aggregates (without limits info)
   */
  current: adminProcedure.query(async ({ ctx }) => {
    return await usageService.getCurrentUsage(ctx.organizationId!);
  }),

  /**
   * Get usage history for dashboard/reporting
   */
  history: adminProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(365).optional().default(30),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      return await usageService.getUsageHistory(ctx.organizationId!, days);
    }),

  /**
   * Get usage aggregated by session
   */
  sessions: adminProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(365).optional().default(30),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      return await usageService.getSessionUsage(ctx.organizationId!, days);
    }),

  /**
   * Get usage aggregated by flow (OpenRouter direct calls)
   */
  flows: adminProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(365).optional().default(30),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      return await usageService.getFlowUsage(ctx.organizationId!, days);
    }),
});
