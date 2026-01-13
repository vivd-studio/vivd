import { z } from "zod";
import { router, adminProcedure } from "../trpc";
import { usageService } from "../services/UsageService";
import { limitsService } from "../services/LimitsService";

export const usageRouter = router({
  /**
   * Get current usage status including limits and warnings
   */
  status: adminProcedure.query(async () => {
    return await limitsService.checkLimits();
  }),

  /**
   * Get current usage aggregates (without limits info)
   */
  current: adminProcedure.query(async () => {
    return await usageService.getCurrentUsage();
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
    .query(async ({ input }) => {
      const days = input?.days ?? 30;
      return await usageService.getUsageHistory(days);
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
    .query(async ({ input }) => {
      const days = input?.days ?? 30;
      return await usageService.getSessionUsage(days);
    }),
});
