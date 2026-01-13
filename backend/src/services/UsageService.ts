import { db } from "../db";
import { usageRecord, usagePeriod } from "../db/schema";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

export type PeriodType = "daily" | "weekly" | "monthly";

export interface TokenData {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

export interface UsageRecord {
  id: string;
  eventType: string;
  cost: string;
  tokens: TokenData | null;
  sessionId: string | null;
  projectSlug: string | null;
  createdAt: Date;
}

export interface PeriodUsage {
  cost: number;
  imageCount: number;
  periodStart: Date;
}

export interface CurrentUsage {
  daily: PeriodUsage;
  weekly: PeriodUsage;
  monthly: PeriodUsage;
}

/**
 * Get the start of the current period for a given period type
 */
function getPeriodStart(type: PeriodType, now: Date = new Date()): Date {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);

  switch (type) {
    case "daily":
      // Start of current day UTC
      return date;

    case "weekly":
      // Start of current week (Sunday) UTC
      const dayOfWeek = date.getUTCDay();
      date.setUTCDate(date.getUTCDate() - dayOfWeek);
      return date;

    case "monthly":
      // Start of current month UTC
      date.setUTCDate(1);
      return date;
  }
}

/**
 * Generate a unique period ID for storage
 */
function getPeriodId(type: PeriodType, periodStart: Date): string {
  const isoDate = periodStart.toISOString().split("T")[0]; // YYYY-MM-DD

  switch (type) {
    case "daily":
      return `daily:${isoDate}`;

    case "weekly":
      // Get ISO week number
      const startOfYear = new Date(
        Date.UTC(periodStart.getUTCFullYear(), 0, 1)
      );
      const days = Math.floor(
        (periodStart.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)
      );
      const weekNum = Math.ceil((days + startOfYear.getUTCDay() + 1) / 7);
      return `weekly:${periodStart.getUTCFullYear()}-W${weekNum
        .toString()
        .padStart(2, "0")}`;

    case "monthly":
      return `monthly:${isoDate.substring(0, 7)}`; // YYYY-MM
  }
}

class UsageService {
  /**
   * Record an AI cost event from OpenCode
   * Uses idempotency key (sessionId:partId) to prevent duplicate recordings
   * All operations are wrapped in a transaction to ensure consistency
   */
  async recordAiCost(
    cost: number,
    tokens?: TokenData,
    sessionId?: string,
    projectSlug?: string,
    partId?: string
  ): Promise<void> {
    const now = new Date();

    // Build idempotency key if we have both session and part IDs
    const idempotencyKey =
      sessionId && partId ? `${sessionId}:${partId}` : undefined;

    try {
      const didInsert = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(usageRecord)
          .values({
            id: randomUUID(),
            eventType: "ai_cost",
            cost: cost.toString(),
            tokens: tokens ?? null,
            sessionId: sessionId ?? null,
            projectSlug: projectSlug ?? null,
            idempotencyKey: idempotencyKey ?? null,
            createdAt: now,
          })
          .onConflictDoNothing({ target: usageRecord.idempotencyKey })
          .returning({ id: usageRecord.id });

        // If we hit a conflict, skip aggregates to avoid double counting
        if (inserted.length === 0) return false;

        await this.updatePeriodAggregatesInTx(tx, cost, 0, now);
        return true;
      });

      if (!didInsert) {
        console.log(
          `[UsageService] Skipped duplicate AI cost record: ${idempotencyKey}`
        );
        return;
      }

      console.log(`[UsageService] Recorded AI cost: $${cost.toFixed(6)}`);
    } catch (error) {
      // Log the error for debugging but don't throw to avoid breaking the stream
      console.error(`[UsageService] Failed to record AI cost:`, error);
    }
  }

  /**
   * Record an image generation event
   * Uses transaction for consistency
   */
  async recordImageGeneration(projectSlug?: string): Promise<void> {
    const now = new Date();
    // Generate a unique idempotency key for image gen (timestamp-based since no partId)
    const idempotencyKey = `image_gen:${
      projectSlug || "unknown"
    }:${now.getTime()}`;

    try {
      const didInsert = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(usageRecord)
          .values({
            id: randomUUID(),
            eventType: "image_gen",
            cost: "0",
            tokens: null,
            sessionId: null,
            projectSlug: projectSlug ?? null,
            idempotencyKey,
            createdAt: now,
          })
          .onConflictDoNothing({ target: usageRecord.idempotencyKey })
          .returning({ id: usageRecord.id });

        if (inserted.length === 0) return false;

        await this.updatePeriodAggregatesInTx(tx, 0, 1, now);
        return true;
      });

      if (!didInsert) {
        console.log(
          `[UsageService] Skipped duplicate image generation record: ${idempotencyKey}`
        );
        return;
      }

      console.log(`[UsageService] Recorded image generation`);
    } catch (error) {
      console.error(`[UsageService] Failed to record image generation:`, error);
    }
  }

  /**
   * Update or create period aggregate records within a transaction
   * This ensures atomicity when recording usage + updating aggregates
   */
  private async updatePeriodAggregatesInTx(
    tx: typeof db | PgTransaction<any, any, any>,
    costDelta: number,
    imageDelta: number,
    now: Date
  ): Promise<void> {
    const periods: PeriodType[] = ["daily", "weekly", "monthly"];

    for (const periodType of periods) {
      const periodStart = getPeriodStart(periodType, now);
      const periodId = getPeriodId(periodType, periodStart);

      // Upsert the period record
      await tx
        .insert(usagePeriod)
        .values({
          id: periodId,
          periodType,
          periodStart,
          totalCost: costDelta.toString(),
          imageCount: imageDelta,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: usagePeriod.id,
          set: {
            totalCost: sql`${usagePeriod.totalCost} + ${costDelta}`,
            imageCount: sql`${usagePeriod.imageCount} + ${imageDelta}`,
            updatedAt: now,
          },
        });
    }
  }

  /**
   * Get current usage for all periods
   */
  async getCurrentUsage(): Promise<CurrentUsage> {
    const now = new Date();
    const result: CurrentUsage = {
      daily: {
        cost: 0,
        imageCount: 0,
        periodStart: getPeriodStart("daily", now),
      },
      weekly: {
        cost: 0,
        imageCount: 0,
        periodStart: getPeriodStart("weekly", now),
      },
      monthly: {
        cost: 0,
        imageCount: 0,
        periodStart: getPeriodStart("monthly", now),
      },
    };

    const periods: PeriodType[] = ["daily", "weekly", "monthly"];

    for (const periodType of periods) {
      const periodStart = getPeriodStart(periodType, now);
      const periodId = getPeriodId(periodType, periodStart);

      const [period] = await db
        .select()
        .from(usagePeriod)
        .where(eq(usagePeriod.id, periodId))
        .limit(1);

      if (period) {
        result[periodType] = {
          cost: parseFloat(period.totalCost),
          imageCount: period.imageCount,
          periodStart: period.periodStart,
        };
      }
    }

    return result;
  }

  /**
   * Get usage history for dashboard (individual records)
   */
  async getUsageHistory(days: number = 30): Promise<UsageRecord[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const records = await db
      .select()
      .from(usageRecord)
      .where(gte(usageRecord.createdAt, since))
      .orderBy(usageRecord.createdAt);

    return records.map((r) => ({
      ...r,
      tokens: r.tokens as TokenData | null,
    }));
  }

  /**
   * Get usage aggregated by session
   */
  async getSessionUsage(days: number = 30) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const records = await db
      .select({
        sessionId: usageRecord.sessionId,
        projectSlug: usageRecord.projectSlug,
        totalCost: sql<string>`sum(${usageRecord.cost})`,
        count: sql<number>`count(*)`,
        lastActive: sql<Date>`max(${usageRecord.createdAt})`,
      })
      .from(usageRecord)
      .where(
        and(
          gte(usageRecord.createdAt, since),
          sql`${usageRecord.sessionId} IS NOT NULL`
        )
      )
      .groupBy(usageRecord.sessionId, usageRecord.projectSlug)
      .orderBy(desc(sql`max(${usageRecord.createdAt})`));

    return records.map((r) => ({
      sessionId: r.sessionId,
      projectSlug: r.projectSlug,
      totalCost: parseFloat(r.totalCost),
      eventCount: Number(r.count),
      lastActive: r.lastActive,
    }));
  }
}

// Export singleton instance
export const usageService = new UsageService();
