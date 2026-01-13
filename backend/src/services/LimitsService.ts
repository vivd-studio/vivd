import { usageService } from "./UsageService";

// Default configuration values
const DEFAULTS = {
  dailyCostLimit: 20,
  weeklyCostLimit: 50,
  monthlyCostLimit: 100,
  imageGenPerMonth: 50,
  warningThreshold: 0.8,
} as const;

/**
 * Parse a number from env var with validation.
 * Returns the default if the value is invalid (NaN, negative, empty).
 * A value of 0 means unlimited (no limit).
 */
function parseEnvNumber(
  envVar: string | undefined,
  defaultValue: number,
  allowZero = true
): number {
  if (!envVar || envVar.trim() === "") {
    return defaultValue;
  }

  const parsed = parseFloat(envVar);

  // Check for NaN or invalid values
  if (!Number.isFinite(parsed)) {
    console.warn(
      `[LimitsService] Invalid config value "${envVar}", using default: ${defaultValue}`
    );
    return defaultValue;
  }

  // Negative values are invalid (except we allow 0 to mean "unlimited")
  if (parsed < 0) {
    console.warn(
      `[LimitsService] Negative config value "${envVar}" not allowed, using default: ${defaultValue}`
    );
    return defaultValue;
  }

  // If allowZero is false and value is 0, use default
  if (!allowZero && parsed === 0) {
    console.warn(
      `[LimitsService] Zero value not allowed for this config, using default: ${defaultValue}`
    );
    return defaultValue;
  }

  return parsed;
}

// Configuration from environment variables with validated defaults
const getConfig = () => ({
  dailyCostLimit: parseEnvNumber(
    process.env.LICENSE_DAILY_COST_LIMIT,
    DEFAULTS.dailyCostLimit
  ),
  weeklyCostLimit: parseEnvNumber(
    process.env.LICENSE_WEEKLY_COST_LIMIT,
    DEFAULTS.weeklyCostLimit
  ),
  monthlyCostLimit: parseEnvNumber(
    process.env.LICENSE_MONTHLY_COST_LIMIT,
    DEFAULTS.monthlyCostLimit
  ),
  imageGenPerMonth: Math.floor(
    parseEnvNumber(
      process.env.LICENSE_IMAGE_GEN_PER_MONTH,
      DEFAULTS.imageGenPerMonth
    )
  ),
  // Warning threshold must be between 0 and 1, don't allow 0 (would warn immediately)
  warningThreshold: Math.min(
    1,
    Math.max(
      0.1,
      parseEnvNumber(
        process.env.LICENSE_WARNING_THRESHOLD,
        DEFAULTS.warningThreshold,
        false
      )
    )
  ),
});

export interface UsageInfo {
  current: number;
  limit: number;
  percentage: number;
}

export interface LimitStatus {
  blocked: boolean; // True if cost limits exceeded (blocks agent/generation)
  imageGenBlocked: boolean; // True if image generation limit exceeded (blocks only images)
  warnings: string[];
  usage: {
    daily: UsageInfo;
    weekly: UsageInfo;
    monthly: UsageInfo;
    imageGen: UsageInfo;
  };
  nextReset: {
    daily: Date;
    weekly: Date;
    monthly: Date;
  };
}

/**
 * Calculate the next reset time for a period
 */
function getNextReset(
  periodType: "daily" | "weekly" | "monthly",
  now: Date = new Date()
): Date {
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);

  switch (periodType) {
    case "daily":
      // Next day at midnight UTC
      next.setUTCDate(next.getUTCDate() + 1);
      break;

    case "weekly":
      // Next Sunday at midnight UTC
      const daysUntilSunday = 7 - next.getUTCDay();
      next.setUTCDate(
        next.getUTCDate() + (daysUntilSunday === 7 ? 7 : daysUntilSunday)
      );
      break;

    case "monthly":
      // First of next month at midnight UTC
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(1);
      break;
  }

  return next;
}

class LimitsService {
  /**
   * Check usage limits and return current status
   */
  async checkLimits(): Promise<LimitStatus> {
    const config = getConfig();
    const currentUsage = await usageService.getCurrentUsage();
    const now = new Date();

    const warnings: string[] = [];
    let blocked = false; // Cost limits exceeded (blocks agent/generation)
    let imageGenBlocked = false; // Image limit exceeded (blocks only images)

    // Helper to calculate usage info
    // Note: A limit of 0 means "unlimited" - percentage is always 0 (never blocked)
    const calculateInfo = (current: number, limit: number): UsageInfo => ({
      current,
      limit,
      percentage: limit > 0 ? current / limit : 0, // 0 limit = unlimited = 0%
    });

    // Check each period
    const daily = calculateInfo(currentUsage.daily.cost, config.dailyCostLimit);
    const weekly = calculateInfo(
      currentUsage.weekly.cost,
      config.weeklyCostLimit
    );
    const monthly = calculateInfo(
      currentUsage.monthly.cost,
      config.monthlyCostLimit
    );
    const imageGen = calculateInfo(
      currentUsage.monthly.imageCount,
      config.imageGenPerMonth
    );

    // Check for cost limit blocks (100%+) - these block agent/generation
    if (daily.percentage >= 1) {
      blocked = true;
      warnings.push(
        `Daily usage limit reached ($${daily.current.toFixed(
          2
        )}/$${daily.limit.toFixed(2)}). Resets at midnight UTC.`
      );
    }
    if (weekly.percentage >= 1) {
      blocked = true;
      warnings.push(
        `Weekly usage limit reached ($${weekly.current.toFixed(
          2
        )}/$${weekly.limit.toFixed(2)}). Resets Sunday UTC.`
      );
    }
    if (monthly.percentage >= 1) {
      blocked = true;
      warnings.push(
        `Monthly usage limit reached ($${monthly.current.toFixed(
          2
        )}/$${monthly.limit.toFixed(2)}). Resets on the 1st.`
      );
    }

    // Check for image generation limit (blocks only image generation, not chat)
    if (imageGen.percentage >= 1) {
      imageGenBlocked = true;
      warnings.push(
        `Monthly image generation limit reached (${imageGen.current}/${imageGen.limit}). Resets on the 1st.`
      );
    }

    // Check for warnings (80%+ but less than 100%)
    // Show cost warnings if not blocked
    if (!blocked) {
      if (daily.percentage >= config.warningThreshold && daily.percentage < 1) {
        warnings.push(
          `Approaching daily limit: $${daily.current.toFixed(
            2
          )}/$${daily.limit.toFixed(2)} (${Math.round(
            daily.percentage * 100
          )}%)`
        );
      }
      if (
        weekly.percentage >= config.warningThreshold &&
        weekly.percentage < 1
      ) {
        warnings.push(
          `Approaching weekly limit: $${weekly.current.toFixed(
            2
          )}/$${weekly.limit.toFixed(2)} (${Math.round(
            weekly.percentage * 100
          )}%)`
        );
      }
      if (
        monthly.percentage >= config.warningThreshold &&
        monthly.percentage < 1
      ) {
        warnings.push(
          `Approaching monthly limit: $${monthly.current.toFixed(
            2
          )}/$${monthly.limit.toFixed(2)} (${Math.round(
            monthly.percentage * 100
          )}%)`
        );
      }
    }

    // Show image gen warnings if not at limit
    if (!imageGenBlocked) {
      if (
        imageGen.percentage >= config.warningThreshold &&
        imageGen.percentage < 1
      ) {
        warnings.push(
          `Approaching image limit: ${imageGen.current}/${
            imageGen.limit
          } (${Math.round(imageGen.percentage * 100)}%)`
        );
      }
    }

    return {
      blocked,
      imageGenBlocked,
      warnings,
      usage: {
        daily,
        weekly,
        monthly,
        imageGen,
      },
      nextReset: {
        daily: getNextReset("daily", now),
        weekly: getNextReset("weekly", now),
        monthly: getNextReset("monthly", now),
      },
    };
  }

  /**
   * Quick check - throws an error if usage is blocked
   * Use this in procedures to prevent actions when limits are exceeded
   */
  async assertNotBlocked(): Promise<void> {
    const status = await this.checkLimits();
    if (status.blocked) {
      throw new Error(`Usage limit exceeded: ${status.warnings.join("; ")}`);
    }
  }

  /**
   * Check if image generation is specifically blocked
   * Throws if either:
   * - Cost limits are exceeded (general block)
   * - Image generation limit is exceeded (image-specific block)
   */
  async assertImageGenNotBlocked(): Promise<void> {
    const status = await this.checkLimits();

    // Check general cost limits first
    if (status.blocked) {
      throw new Error(`Usage limit exceeded: ${status.warnings.join("; ")}`);
    }

    // Check image-specific limit
    if (status.imageGenBlocked) {
      throw new Error(
        `Image generation limit reached: ${status.usage.imageGen.current}/${status.usage.imageGen.limit} images this month`
      );
    }
  }
}

// Export singleton instance
export const limitsService = new LimitsService();
