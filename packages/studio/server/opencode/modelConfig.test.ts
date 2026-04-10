import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getClientAndDirectoryMock, configProvidersMock } = vi.hoisted(() => ({
  getClientAndDirectoryMock: vi.fn(),
  configProvidersMock: vi.fn(),
}));

vi.mock("./serverManager.js", () => ({
  serverManager: {
    getClientAndDirectory: getClientAndDirectoryMock,
  },
}));

import {
  getAvailableModels,
  getAvailableModelsWithMetadata,
  getDefaultModel,
} from "./modelConfig.js";

describe("OpenCode model config", () => {
  beforeEach(() => {
    getClientAndDirectoryMock.mockReset();
    configProvidersMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the configured model tiers in standard, advanced, pro order", () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "openrouter/google/gemini-2.5-flash");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED", "openrouter/google/gemini-3-pro-preview");
    vi.stubEnv("OPENCODE_MODEL_PRO", "openrouter/google/gemini-3-pro-preview");
    vi.stubEnv("OPENCODE_MODEL_PRO_VARIANT", "high");

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
        variant: "high",
        label: "Pro",
      },
    ]);
  });

  it("defaults general chat to the standard tier", () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "openrouter/google/gemini-2.5-flash");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED", "openrouter/google/gemini-3-pro-preview");
    vi.stubEnv("OPENCODE_MODEL_STANDARD_VARIANT", "low");

    expect(getDefaultModel()).toEqual({
      provider: "openrouter",
      modelId: "google/gemini-2.5-flash",
      variant: "low",
    });
  });

  it("ignores invalid tier values and returns no models when nothing valid is configured", () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "broken-model-value");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED", "");

    expect(getAvailableModels()).toEqual([]);
    expect(getDefaultModel()).toBeNull();
  });

  it("enriches configured models with provider metadata when available", async () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "openrouter/google/gemini-2.5-flash");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED", "openrouter/google/gemini-3-pro-preview");
    vi.stubEnv("OPENCODE_MODEL_ADVANCED_VARIANT", "high");

    configProvidersMock.mockResolvedValue({
      error: null,
      data: {
        providers: [
          {
            id: "openrouter",
            name: "OpenRouter",
            models: {
              "google/gemini-2.5-flash": {
                id: "google/gemini-2.5-flash",
                name: "Gemini 2.5 Flash",
                limit: {
                  context: 1_048_576,
                  input: 786_432,
                },
              },
              "google/gemini-3-pro-preview": {
                id: "google/gemini-3-pro-preview",
                name: "Gemini 3 Pro Preview",
                limit: {
                  context: 2_000_000,
                  input: 1_500_000,
                },
              },
            },
          },
        ],
      },
    });
    getClientAndDirectoryMock.mockResolvedValue({
      directory: "/tmp/workspace",
      client: {
        config: {
          providers: configProvidersMock,
        },
      },
    });

    await expect(
      getAvailableModelsWithMetadata("/workspace/project"),
    ).resolves.toEqual([
      {
        tier: "standard",
        provider: "openrouter",
        modelId: "google/gemini-2.5-flash",
        label: "Standard",
        providerLabel: "OpenRouter",
        modelLabel: "Gemini 2.5 Flash",
        contextLimit: 1_048_576,
        inputLimit: 786_432,
      },
      {
        tier: "advanced",
        provider: "openrouter",
        modelId: "google/gemini-3-pro-preview",
        variant: "high",
        label: "Advanced",
        providerLabel: "OpenRouter",
        modelLabel: "Gemini 3 Pro Preview",
        contextLimit: 2_000_000,
        inputLimit: 1_500_000,
      },
    ]);

    expect(getClientAndDirectoryMock).toHaveBeenCalledWith("/workspace/project");
    expect(configProvidersMock).toHaveBeenCalledWith({
      directory: "/tmp/workspace",
    });
  });

  it("keeps validation variant-aware when multiple tiers share a model id", async () => {
    vi.stubEnv("OPENCODE_MODEL_STANDARD", "openrouter/openai/gpt-5.4");
    vi.stubEnv("OPENCODE_MODEL_PRO", "openrouter/openai/gpt-5.4");
    vi.stubEnv("OPENCODE_MODEL_PRO_VARIANT", "high");

    const { validateModelSelection } = await import("./modelConfig.js");

    expect(
      validateModelSelection({
        provider: "openrouter",
        modelId: "openai/gpt-5.4",
        variant: "high",
      }),
    ).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-5.4",
      variant: "high",
    });

    expect(
      validateModelSelection({
        provider: "openrouter",
        modelId: "openai/gpt-5.4",
      }),
    ).toEqual({
      provider: "openrouter",
      modelId: "openai/gpt-5.4",
    });
  });
});
