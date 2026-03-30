/**
 * OpenCode Model Configuration
 *
 * Reads explicit environment variables for the available model tiers.
 */

export interface ModelTier {
  tier: "standard" | "advanced" | "pro";
  provider: string;
  modelId: string;
  label: string;
  providerLabel?: string;
  modelLabel?: string;
  contextLimit?: number;
  inputLimit?: number;
}

export interface ModelSelection {
  provider: string;
  modelId: string;
}

const TIER_LABELS: Record<string, string> = {
  standard: "Standard",
  advanced: "Advanced",
  pro: "Pro",
};

const TIER_ENV_VARS: Record<ModelTier["tier"], string> = {
  standard: "OPENCODE_MODEL_STANDARD",
  advanced: "OPENCODE_MODEL_ADVANCED",
  pro: "OPENCODE_MODEL_PRO",
};

export function getAvailableModels(): ModelTier[] {
  return getConfiguredModels();
}

export async function getAvailableModelsWithMetadata(
  directory: string,
): Promise<ModelTier[]> {
  const configured = getConfiguredModels();
  if (configured.length === 0) {
    return configured;
  }

  try {
    const { serverManager } = await import("./serverManager.js");
    const { client, directory: opencodeDir } =
      await serverManager.getClientAndDirectory(directory);
    const result = await client.config.providers({ directory: opencodeDir });
    if (result.error) {
      return configured;
    }

    const providers = Array.isArray(result.data?.providers)
      ? result.data.providers
      : [];
    if (providers.length === 0) {
      return configured;
    }

    return configured.map((model) => {
      const provider = providers.find((entry) => entry?.id === model.provider);
      const providerModel = provider?.models?.[model.modelId];

      return {
        ...model,
        providerLabel:
          typeof provider?.name === "string" && provider.name.trim().length > 0
            ? provider.name
            : model.provider,
        modelLabel:
          typeof providerModel?.name === "string" &&
          providerModel.name.trim().length > 0
            ? providerModel.name
            : model.modelId,
        contextLimit: toFinitePositiveNumber(providerModel?.limit?.context),
        inputLimit: toFinitePositiveNumber(providerModel?.limit?.input),
      };
    });
  } catch {
    return configured;
  }
}

function getConfiguredModels(): ModelTier[] {
  return (["standard", "advanced", "pro"] as const)
    .map((tier) => parseTierModel(tier))
    .filter((value): value is ModelTier => value !== null);
}

export function getDefaultModel(): ModelSelection | null {
  const models = getAvailableModels();
  if (models.length === 0) {
    return null;
  }

  return {
    provider: models[0].provider,
    modelId: models[0].modelId,
  };
}

export function validateModelSelection(
  model: ModelSelection,
): ModelSelection | null {
  const available = getAvailableModels();
  const found = available.find(
    (m) => m.provider === model.provider && m.modelId === model.modelId,
  );
  return found ? { provider: model.provider, modelId: model.modelId } : null;
}

function parseTierModel(tier: ModelTier["tier"]): ModelTier | null {
  const rawValue = (process.env[TIER_ENV_VARS[tier]] || "").trim();
  if (!rawValue) return null;

  const slashIndex = rawValue.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= rawValue.length - 1) {
    return null;
  }

  return {
    tier,
    provider: rawValue.slice(0, slashIndex),
    modelId: rawValue.slice(slashIndex + 1),
    label: TIER_LABELS[tier],
  };
}

function toFinitePositiveNumber(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return numeric;
}
