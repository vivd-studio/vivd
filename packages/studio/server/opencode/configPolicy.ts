type JsonObject = Record<string, unknown>;

export interface BuildStudioOpencodeConfigOptions {
  toolEnablement?: Record<string, boolean>;
}

export const STUDIO_OPENCODE_CONFIG_OVERRIDES: JsonObject = {
  tools: {
    // Keep the upstream question tool available in Studio sessions.
    question: true,
  },
  // Prevent recursive tool-invocation loops in Studio agent sessions.
  permission: {
    doom_loop: "deny",
    external_directory: "deny",
  },
};

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOpencodeConfigContent(rawContent: string | undefined): JsonObject {
  const raw = rawContent?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) {
      return parsed;
    }

    console.warn(
      "[OpenCode] Ignoring non-object OPENCODE_CONFIG_CONTENT; falling back to generated config.",
    );
  } catch {
    console.warn(
      "[OpenCode] Failed to parse OPENCODE_CONFIG_CONTENT; falling back to generated config.",
    );
  }

  return {};
}

function mergePlainObjects(base: JsonObject, overrides: JsonObject): JsonObject {
  const result: JsonObject = { ...base };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseValue = result[key];

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = mergePlainObjects(baseValue, overrideValue);
      continue;
    }

    result[key] = overrideValue;
  }

  return result;
}

export function applyStudioOpencodeConfigPolicy(config: JsonObject): JsonObject {
  return mergePlainObjects(config, STUDIO_OPENCODE_CONFIG_OVERRIDES);
}

export function buildStudioOpencodeConfigContent(
  rawContent: string | undefined,
  options?: BuildStudioOpencodeConfigOptions,
): string {
  const parsed = parseOpencodeConfigContent(rawContent);
  const merged = applyStudioOpencodeConfigPolicy(parsed);
  const toolEnablement = options?.toolEnablement;

  if (toolEnablement && Object.keys(toolEnablement).length > 0) {
    return JSON.stringify(
      mergePlainObjects(merged, {
        tools: toolEnablement,
      }),
    );
  }

  return JSON.stringify(merged);
}
