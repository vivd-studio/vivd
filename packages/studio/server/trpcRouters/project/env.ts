export function readEnabledPluginsFromEnv(): string[] {
  const raw = (process.env.VIVD_ENABLED_PLUGINS || "").trim();
  if (!raw) return [];

  const unique = new Set<string>();
  for (const entry of raw.split(",")) {
    const normalized = entry.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }

  return Array.from(unique);
}

export function readSupportEmailFromEnv(): string | null {
  const value = (process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL || "").trim();
  return value || null;
}

export function readProjectSlugFromEnv(): string | null {
  const value = (process.env.VIVD_PROJECT_SLUG || "").trim();
  return value || null;
}
