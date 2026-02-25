import { z } from "zod";

const ORGANIZATION_ID_MAX_LENGTH = 128;
const ORGANIZATION_SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function hasInvalidOrganizationIdChars(value: string): boolean {
  return /[\u0000-\u001f\u007f\s/\\]/.test(value);
}

export function normalizeOrganizationId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim();
  if (!normalized) return null;
  if (normalized.length > ORGANIZATION_ID_MAX_LENGTH) return null;
  if (hasInvalidOrganizationIdChars(normalized)) return null;
  return normalized;
}

export const organizationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_ID_MAX_LENGTH)
  .refine((value) => {
    return !hasInvalidOrganizationIdChars(value);
  }, "Invalid organization id");

export const organizationSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(ORGANIZATION_SLUG_REGEX, "Invalid organization slug");
