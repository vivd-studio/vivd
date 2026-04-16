/**
 * OpenCode Model Configuration
 *
 * Reads explicit environment variables for the available model tiers.
 */

import {
  getDefaultModelSelection,
  parseConfiguredModelTiers,
  validateModelSelectionAgainstAvailable,
  type ModelSelection,
  type ModelTier,
} from "@vivd/shared";

export type { ModelSelection, ModelTier } from "@vivd/shared";

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
  return parseConfiguredModelTiers(process.env);
}

export function getDefaultModel(): ModelSelection | null {
  return getDefaultModelSelection(getAvailableModels());
}

export function validateModelSelection(
  model: ModelSelection,
): ModelSelection | null {
  return validateModelSelectionAgainstAvailable(model, getAvailableModels());
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
