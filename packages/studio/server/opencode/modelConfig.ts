/**
 * OpenCode Model Configuration
 *
 * Parses OPENCODE_MODELS environment variable to support multiple model tiers.
 * Falls back to OPENCODE_MODEL if not set.
 *
 * Format: "tier:provider/modelId,tier:provider/modelId"
 * Example: "standard:anthropic/claude-3-5-sonnet-20241022,advanced:anthropic/claude-sonnet-4-20250514"
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

export function getAvailableModels(): ModelTier[] {
  const modelsEnv = process.env.OPENCODE_MODELS;

  if (modelsEnv) {
    const parsed = parseModelsEnv(modelsEnv);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  const singleModel = process.env.OPENCODE_MODEL;
  if (singleModel) {
    const [provider, modelId] = singleModel.split("/");
    if (provider && modelId) {
      return [
        {
          tier: "standard",
          provider,
          modelId,
          label: "Standard",
        },
      ];
    }
  }

  return [];
}

function parseModelsEnv(envValue: string): ModelTier[] {
  const models: ModelTier[] = [];
  const entries = envValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const colonIndex = entry.indexOf(":");
    if (colonIndex === -1) continue;

    const tier = entry.slice(0, colonIndex).toLowerCase();
    const modelPath = entry.slice(colonIndex + 1);

    if (!["standard", "advanced", "pro"].includes(tier)) continue;

    const slashIndex = modelPath.indexOf("/");
    if (slashIndex === -1) continue;

    const provider = modelPath.slice(0, slashIndex);
    const modelId = modelPath.slice(slashIndex + 1);

    if (!provider || !modelId) continue;

    models.push({
      tier: tier as "standard" | "advanced" | "pro",
      provider,
      modelId,
      label: TIER_LABELS[tier] || tier,
    });
  }

  return models;
}

export function getDefaultModel(): ModelSelection | null {
  const models = getAvailableModels();
  if (models.length === 0) {
    const fallback = process.env.OPENCODE_MODEL;
    if (fallback) {
      const [provider, modelId] = fallback.split("/");
      if (provider && modelId) {
        return { provider, modelId };
      }
    }
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
