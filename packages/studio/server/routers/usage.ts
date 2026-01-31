import { router, publicProcedure } from "../trpc/trpc.js";
import { isConnectedMode } from "@vivd/shared";
import { usageReporter, type UsageStatus } from "../services/UsageReporter.js";

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

/**
 * Get unlimited usage status stub for standalone mode.
 */
function getUnlimitedStatus(): UsageStatus {
  const now = new Date();
  return {
    blocked: false,
    imageGenBlocked: false,
    warnings: [],
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
}

/**
 * Get blocked status when backend is unavailable in connected mode.
 * This prevents bypassing limits when the backend cannot be reached.
 */
function getBackendUnavailableStatus(): UsageStatus {
  const now = new Date();
  return {
    blocked: true,
    imageGenBlocked: true,
    warnings: ["Unable to verify usage limits - backend unavailable. Please try again later."],
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
}

export const usageRouter = router({
  status: publicProcedure.query(async () => {
    // In connected mode, fetch status from main backend
    if (isConnectedMode()) {
      const backendStatus = await usageReporter.fetchStatus();
      if (backendStatus) {
        return backendStatus;
      }
      // Block usage if backend is unavailable - don't allow bypassing limits
      console.error("[Usage] Failed to fetch status from backend - blocking usage");
      return getBackendUnavailableStatus();
    }

    // Standalone mode: return unlimited stub
    return getUnlimitedStatus();
  }),
});
