export type ModelTierName = "standard" | "advanced" | "pro";

export interface ModelSelection {
  provider: string;
  modelId: string;
  variant?: string;
}

export interface ModelTier extends ModelSelection {
  tier: ModelTierName;
  label: string;
  providerLabel?: string;
  modelLabel?: string;
  contextLimit?: number;
  inputLimit?: number;
}

export const MODEL_TIER_LABELS: Record<ModelTierName, string> = {
  standard: "Standard",
  advanced: "Advanced",
  pro: "Pro",
};

export const MODEL_TIER_ENV_VARS: Record<ModelTierName, string> = {
  standard: "OPENCODE_MODEL_STANDARD",
  advanced: "OPENCODE_MODEL_ADVANCED",
  pro: "OPENCODE_MODEL_PRO",
};

export const MODEL_TIER_VARIANT_ENV_VARS: Record<ModelTierName, string> = {
  standard: "OPENCODE_MODEL_STANDARD_VARIANT",
  advanced: "OPENCODE_MODEL_ADVANCED_VARIANT",
  pro: "OPENCODE_MODEL_PRO_VARIANT",
};

export function parseConfiguredModelTiers(
  env: Record<string, string | undefined>,
): ModelTier[] {
  return (["standard", "advanced", "pro"] as const)
    .map((tier) => parseConfiguredModelTier(tier, env))
    .filter((value): value is ModelTier => value !== null);
}

export function getDefaultModelSelection(
  models: readonly ModelTier[],
): ModelSelection | null {
  if (models.length === 0) {
    return null;
  }

  return toModelSelection(models[0]);
}

export function validateModelSelectionAgainstAvailable(
  model: ModelSelection,
  available: readonly Pick<ModelSelection, "provider" | "modelId" | "variant">[],
): ModelSelection | null {
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

export function toModelSelection(
  model: Pick<ModelSelection, "provider" | "modelId" | "variant">,
): ModelSelection {
  return {
    provider: model.provider,
    modelId: model.modelId,
    ...(model.variant ? { variant: model.variant } : {}),
  };
}

export function sameModelSelection(
  left: Pick<ModelSelection, "provider" | "modelId" | "variant">,
  right: Pick<ModelSelection, "provider" | "modelId" | "variant">,
): boolean {
  return (
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    (left.variant || undefined) === (right.variant || undefined)
  );
}

function parseConfiguredModelTier(
  tier: ModelTierName,
  env: Record<string, string | undefined>,
): ModelTier | null {
  const rawValue = (env[MODEL_TIER_ENV_VARS[tier]] || "").trim();
  if (!rawValue) return null;

  const slashIndex = rawValue.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= rawValue.length - 1) {
    return null;
  }

  const rawVariant = (env[MODEL_TIER_VARIANT_ENV_VARS[tier]] || "").trim();

  return {
    tier,
    provider: rawValue.slice(0, slashIndex),
    modelId: rawValue.slice(slashIndex + 1),
    ...(rawVariant ? { variant: rawVariant } : {}),
    label: MODEL_TIER_LABELS[tier],
  };
}
