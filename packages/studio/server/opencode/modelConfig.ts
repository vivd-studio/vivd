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

export function getPreferredInitialGenerationModel(): ModelSelection | null {
  const models = getAvailableModels();
  const advancedModel = models.find((model) => model.tier === "advanced");

  if (advancedModel) {
    return {
      provider: advancedModel.provider,
      modelId: advancedModel.modelId,
    };
  }

  return getDefaultModel();
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
