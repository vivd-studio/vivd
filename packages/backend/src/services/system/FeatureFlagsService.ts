function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function isExperimentalSoloModeEnabled(): boolean {
  return parseBoolean(process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE) === true;
}

export function isSelfHostAdminFeaturesEnabled(): boolean {
  return parseBoolean(process.env.VIVD_ENABLE_SELF_HOST_ADMIN_FEATURES) === true;
}
