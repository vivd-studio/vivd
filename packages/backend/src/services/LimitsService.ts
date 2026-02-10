import { usageService } from "./UsageService";
import type { LimitsConfig } from "@vivd/shared/types";
import { db } from "../db";
import { organization } from "../db/schema";
import { eq } from "drizzle-orm";

// Default configuration values (in credits, where 1 credit = 1 cent)
// Original dollar defaults halved, then multiplied by 100
const DEFAULTS = {
  dailyCreditLimit: 1000, // was $20 → $10 → 1000 credits
  weeklyCreditLimit: 2500, // was $50 → $25 → 2500 credits
  monthlyCreditLimit: 5000, // was $100 → $50 → 5000 credits
  imageGenPerMonth: 25, // halved from 50
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

/**
 * Get configuration from environment variables (self-hosted mode).
 * All credit limits are in credits (1 credit = 1 cent).
 */
function getEnvConfig(): LimitsConfig {
  return {
    dailyCreditLimit: parseEnvNumber(
      process.env.LICENSE_DAILY_CREDIT_LIMIT,
      DEFAULTS.dailyCreditLimit
    ),
    weeklyCreditLimit: parseEnvNumber(
      process.env.LICENSE_WEEKLY_CREDIT_LIMIT,
      DEFAULTS.weeklyCreditLimit
    ),
    monthlyCreditLimit: parseEnvNumber(
      process.env.LICENSE_MONTHLY_CREDIT_LIMIT,
      DEFAULTS.monthlyCreditLimit
    ),
    imageGenPerMonth: Math.floor(
      parseEnvNumber(
        process.env.LICENSE_IMAGE_GEN_PER_MONTH,
        DEFAULTS.imageGenPerMonth
      )
    ),
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
  };
}

function parseConfigOverrides(value: unknown): Partial<LimitsConfig> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;

  const pickNumber = (key: keyof LimitsConfig): number | undefined => {
    const raw = record[key as string];
    if (typeof raw !== "number") return undefined;
    if (!Number.isFinite(raw) || raw < 0) return undefined;
    return raw;
  };

  const pickInt = (key: keyof LimitsConfig): number | undefined => {
    const raw = pickNumber(key);
    if (raw === undefined) return undefined;
    return Math.floor(raw);
  };

  const warningThreshold = (() => {
    const raw = pickNumber("warningThreshold");
    if (raw === undefined) return undefined;
    return Math.min(1, Math.max(0.1, raw));
  })();

  return {
    dailyCreditLimit: pickNumber("dailyCreditLimit"),
    weeklyCreditLimit: pickNumber("weeklyCreditLimit"),
    monthlyCreditLimit: pickNumber("monthlyCreditLimit"),
    imageGenPerMonth: pickInt("imageGenPerMonth"),
    warningThreshold,
  };
}

async function getConfig(organizationId: string): Promise<LimitsConfig> {
  const envConfig = getEnvConfig();
  try {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { limits: true },
    });
    const overrides = parseConfigOverrides(org?.limits);
    return {
      ...envConfig,
      ...overrides,
    };
  } catch {
    return envConfig;
  }
}

export interface UsageInfo {
  current: number;
  limit: number;
  percentage: number;
}

export interface LimitStatus {
  blocked: boolean; // True if credit limits exceeded (blocks agent/generation)
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
  async checkLimits(organizationId: string): Promise<LimitStatus> {
    const config = await getConfig(organizationId);
    const currentUsage = await usageService.getCurrentUsage(organizationId);
    const now = new Date();

    const warnings: string[] = [];
    let blocked = false; // Credit limits exceeded (blocks agent/generation)
    let imageGenBlocked = false; // Image limit exceeded (blocks only images)

    // Helper to calculate usage info
    // Note: A limit of 0 means "unlimited" - percentage is always 0 (never blocked)
    const calculateInfo = (current: number, limit: number): UsageInfo => ({
      current,
      limit,
      percentage: limit > 0 ? current / limit : 0, // 0 limit = unlimited = 0%
    });

    // Check each period - convert dollar costs to credits (×100)
    const daily = calculateInfo(
      currentUsage.daily.cost * 100,
      config.dailyCreditLimit
    );
    const weekly = calculateInfo(
      currentUsage.weekly.cost * 100,
      config.weeklyCreditLimit
    );
    const monthly = calculateInfo(
      currentUsage.monthly.cost * 100,
      config.monthlyCreditLimit
    );
    const imageGen = calculateInfo(
      currentUsage.monthly.imageCount,
      config.imageGenPerMonth
    );

    // Check for credit limit blocks (100%+) - these block agent/generation
    if (daily.percentage >= 1) {
      blocked = true;
      warnings.push(
        `Daily usage limit reached (${Math.round(daily.current)}/${Math.round(
          daily.limit
        )} credits). Resets at midnight UTC.`
      );
    }
    if (weekly.percentage >= 1) {
      blocked = true;
      warnings.push(
        `Weekly usage limit reached (${Math.round(weekly.current)}/${Math.round(
          weekly.limit
        )} credits). Resets Sunday UTC.`
      );
    }
    if (monthly.percentage >= 1) {
      blocked = true;
      warnings.push(
        `Monthly usage limit reached (${Math.round(
          monthly.current
        )}/${Math.round(monthly.limit)} credits). Resets on the 1st.`
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
    // Show credit warnings if not blocked
    if (!blocked) {
      if (daily.percentage >= config.warningThreshold && daily.percentage < 1) {
        warnings.push(
          `Approaching daily limit: ${Math.round(daily.current)}/${Math.round(
            daily.limit
          )} credits (${Math.round(daily.percentage * 100)}%)`
        );
      }
      if (
        weekly.percentage >= config.warningThreshold &&
        weekly.percentage < 1
      ) {
        warnings.push(
          `Approaching weekly limit: ${Math.round(weekly.current)}/${Math.round(
            weekly.limit
          )} credits (${Math.round(weekly.percentage * 100)}%)`
        );
      }
      if (
        monthly.percentage >= config.warningThreshold &&
        monthly.percentage < 1
      ) {
        warnings.push(
          `Approaching monthly limit: ${Math.round(
            monthly.current
          )}/${Math.round(monthly.limit)} credits (${Math.round(
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
  async assertNotBlocked(organizationId: string): Promise<void> {
    const status = await this.checkLimits(organizationId);
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
  async assertImageGenNotBlocked(organizationId: string): Promise<void> {
    const status = await this.checkLimits(organizationId);

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
