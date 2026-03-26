export function getDefinedStudioMachineEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const definedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      definedEnv[key] = value;
    }
  }

  return definedEnv;
}

export function parseStudioMachineEnvKeyList(raw: string): string[] {
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function withMissingStudioMachineEnvKeys(
  env: Record<string, string>,
  keys: Iterable<string>,
): Record<string, string> {
  const result = { ...env };

  for (const key of keys) {
    if (!(key in result)) {
      result[key] = "";
    }
  }

  return result;
}

export function mergeManagedStudioMachineEnv(options: {
  currentEnv: Record<string, string> | undefined;
  desiredEnv: Record<string, string>;
  driftSubset: Record<string, string>;
}): Record<string, string> {
  const merged = { ...(options.currentEnv || {}) };

  for (const [key, value] of Object.entries(options.driftSubset)) {
    if (value.trim().length === 0) {
      delete merged[key];
    }
  }

  for (const [key, value] of Object.entries(options.desiredEnv)) {
    merged[key] = value;
  }

  return merged;
}
