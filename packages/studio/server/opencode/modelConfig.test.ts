import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAvailableModels,
  getDefaultModel,
  getPreferredInitialGenerationModel,
} from "./modelConfig.js";

describe("OpenCode model config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the configured model tiers in standard, advanced, pro order", () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "openrouter/google/gemini-2.5-flash");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED", "openrouter/google/gemini-3-pro-preview");
    vi.stubEnv("OPENCODE_MODEL_PRO", "openrouter/google/gemini-3-pro-preview");

    expect(getAvailableModels()).toEqual([
      {
        tier: "standard",
        provider: "openrouter",
        modelId: "google/gemini-2.5-flash",
        label: "Standard",
      },
      {
        tier: "advanced",
        provider: "openrouter",
        modelId: "google/gemini-3-pro-preview",
        label: "Advanced",
      },
      {
        tier: "pro",
        provider: "openrouter",
        modelId: "google/gemini-3-pro-preview",
        label: "Pro",
      },
    ]);
  });

  it("prefers advanced for initial generation while defaulting general chat to standard", () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "openrouter/google/gemini-2.5-flash");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED", "openrouter/google/gemini-3-pro-preview");

    expect(getDefaultModel()).toEqual({
      provider: "openrouter",
      modelId: "google/gemini-2.5-flash",
    });
    expect(getPreferredInitialGenerationModel()).toEqual({
      provider: "openrouter",
      modelId: "google/gemini-3-pro-preview",
    });
  });

  it("ignores invalid tier values and returns no models when nothing valid is configured", () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "broken-model-value");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED", "");

    expect(getAvailableModels()).toEqual([]);
    expect(getDefaultModel()).toBeNull();
    expect(getPreferredInitialGenerationModel()).toBeNull();
  });
});
