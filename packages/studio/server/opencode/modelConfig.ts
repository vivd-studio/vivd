/**
 * OpenCode Model Configuration
 *
 * Reads explicit environment variables for the available model tiers.
 */

export interface ModelTier {
  tier: "standard" | "advanced" | "pro";
  provider: string;
  modelId: string;
  variant?: string;
  label: string;
  providerLabel?: string;
  modelLabel?: string;
  contextLimit?: number;
  inputLimit?: number;
}

export interface ModelSelection {
  provider: string;
  modelId: string;
  variant?: string;
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

const TIER_VARIANT_ENV_VARS: Record<ModelTier["tier"], string> = {
  standard: "OPENCODE_MODEL_STANDARD_VARIANT",
  advanced: "OPENCODE_MODEL_ADVANCED_VARIANT",
  pro: "OPENCODE_MODEL_PRO_VARIANT",
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

  return toModelSelection(models[0]);
}

export function validateModelSelection(
  model: ModelSelection,
): ModelSelection | null {
  const available = getAvailableModels();
  const exactMatch = available.find((candidate) =>
    sameModelSelection(candidate, model),
  );
  if (exactMatch) {
    return toModelSelection(exactMatch);
  }

  if (model.variant) {
    return null;
  }

  const providerModelMatch = available.find(
    (candidate) =>
      candidate.provider === model.provider && candidate.modelId === model.modelId,
  );
  return providerModelMatch ? toModelSelection(providerModelMatch) : null;
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
    ...readTierVariant(tier),
    label: TIER_LABELS[tier],
  };
}

function readTierVariant(
  tier: ModelTier["tier"],
): Pick<ModelTier, "variant"> | Record<string, never> {
  const rawValue = (process.env[TIER_VARIANT_ENV_VARS[tier]] || "").trim();
  if (!rawValue) {
    return {};
  }

  return { variant: rawValue };
}

function sameModelSelection(
  left: Pick<ModelSelection, "provider" | "modelId" | "variant">,
  right: Pick<ModelSelection, "provider" | "modelId" | "variant">,
): boolean {
  return (
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    (left.variant || undefined) === (right.variant || undefined)
  );
}

function toModelSelection(model: ModelSelection): ModelSelection {
  return {
    provider: model.provider,
    modelId: model.modelId,
    ...(model.variant ? { variant: model.variant } : {}),
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
