import type { LimitsForm, LimitsPatch } from "./types";

export function formatRoleLabel(role: string): string {
  if (role === "member") return "User";
  return role
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatLimit(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value === 0) {
    return "Unlimited";
  }
  return Math.round(value).toLocaleString();
}

export function formatUsage(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

export function isUnlimited(value: number | undefined | null): boolean {
  return value === undefined || value === null || !Number.isFinite(value) || value === 0;
}

export function safePercentage(current: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(current)) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function toLimitsPatch(input: LimitsForm): LimitsPatch {
  const patch: LimitsPatch = {};
  const daily = parseOptionalNumber(input.dailyCreditLimit);
  const weekly = parseOptionalNumber(input.weeklyCreditLimit);
  const monthly = parseOptionalNumber(input.monthlyCreditLimit);
  const imageGen = parseOptionalNumber(input.imageGenPerMonth);
  const warning = parseOptionalNumber(input.warningThreshold);
  const maxProjects = parseOptionalNumber(input.maxProjects);

  if (daily !== undefined) patch.dailyCreditLimit = Math.max(0, daily);
  if (weekly !== undefined) patch.weeklyCreditLimit = Math.max(0, weekly);
  if (monthly !== undefined) patch.monthlyCreditLimit = Math.max(0, monthly);
  if (imageGen !== undefined) patch.imageGenPerMonth = Math.max(0, Math.floor(imageGen));
  if (warning !== undefined) patch.warningThreshold = Math.min(1, Math.max(0, warning));
  if (maxProjects !== undefined) patch.maxProjects = Math.max(0, Math.floor(maxProjects));

  return patch;
}
