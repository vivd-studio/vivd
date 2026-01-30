import { router, publicProcedure } from "../trpc/trpc.js";

function nextReset(period: "daily" | "weekly" | "monthly", now: Date = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);

  switch (period) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "weekly": {
      const daysUntilSunday = 7 - next.getUTCDay();
      next.setUTCDate(next.getUTCDate() + (daysUntilSunday === 7 ? 7 : daysUntilSunday));
      break;
    }
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(1);
      break;
  }

  return next;
}

export const usageRouter = router({
  status: publicProcedure.query(async () => {
    // Standalone studio currently does not track usage limits.
    // Return an "unblocked" status in the same shape as the main backend.
    const now = new Date();
    return {
      blocked: false,
      imageGenBlocked: false,
      warnings: [] as string[],
      usage: {
        daily: { current: 0, limit: 0, percentage: 0 },
        weekly: { current: 0, limit: 0, percentage: 0 },
        monthly: { current: 0, limit: 0, percentage: 0 },
        imageGen: { current: 0, limit: 0, percentage: 0 },
      },
      nextReset: {
        daily: nextReset("daily", now),
        weekly: nextReset("weekly", now),
        monthly: nextReset("monthly", now),
      },
    };
  }),
});

