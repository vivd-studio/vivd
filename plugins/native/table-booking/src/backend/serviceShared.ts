import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  tableBookingPluginConfigSchema,
  type TableBookingPluginConfig,
} from "./config";

export const emailSchema = z.string().trim().email();
export const phoneSchema = z.string().trim().min(3).max(64);
export const guestNameSchema = z.string().trim().min(1).max(120);
export const partySizeSchema = z.number().int().min(1).max(50);
export const sourceChannelSchema = z.enum([
  "online",
  "phone",
  "walk_in",
  "staff_manual",
]);
export const capacityAdjustmentModeSchema = z.enum([
  "cover_holdback",
  "effective_capacity_override",
  "closed",
]);

export const TOKEN_RATE_LIMIT_PER_MINUTE = 30;
export const IP_RATE_LIMIT_PER_HOUR = 25;
export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
export const CANCEL_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeTableBookingConfig(
  configJson: unknown,
): TableBookingPluginConfig {
  const parsed = tableBookingPluginConfigSchema.safeParse(configJson ?? {});
  if (parsed.success) return parsed.data;
  return tableBookingPluginConfigSchema.parse({ timezone: "UTC" });
}

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = (value || "").trim().slice(0, maxLength);
  return normalized || null;
}

export function normalizeRequiredText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashClientIp(value: string | null | undefined): string | null {
  const normalized = (value || "").trim();
  if (!normalized) return null;
  return hashToken(normalized);
}

export function createRawToken(): string {
  return randomBytes(24).toString("hex");
}

export function coerceDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function toIsoString(value: unknown): string | null {
  const parsed = coerceDateValue(value);
  return parsed ? parsed.toISOString() : null;
}

export function toDateTimeDisplayString(
  value: unknown,
  fallback: string,
): string {
  const isoString = toIsoString(value);
  if (isoString) return isoString;
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

export function getServiceDateFallback(value: string): string {
  return toIsoString(`${value}T00:00:00.000Z`) ?? value;
}

export function toCount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
