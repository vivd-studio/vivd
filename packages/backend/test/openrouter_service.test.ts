import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/usage/UsageService", () => ({
  usageService: {
    recordOpenRouterCost: vi.fn(),
  },
}));

async function loadOpenRouterService() {
  return await import("../src/services/integrations/OpenRouterService");
}

describe("OpenRouterService", () => {
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (originalOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    }
  });

  it("does not throw on import when OPENROUTER_API_KEY is missing", async () => {
    await expect(loadOpenRouterService()).resolves.toMatchObject({
      getOpenRouterClient: expect.any(Function),
      openai: expect.any(Object),
    });
  });

  it("only throws when the OpenRouter client is actually accessed without credentials", async () => {
    const module = await loadOpenRouterService();

    expect(() => module.getOpenRouterClient()).toThrowError(
      "OPENROUTER_API_KEY is required to use OpenRouter-backed generation services.",
    );
    expect(() => module.openai.chat).toThrowError(
      "OPENROUTER_API_KEY is required to use OpenRouter-backed generation services.",
    );
  });

  it("creates and memoizes the client once OPENROUTER_API_KEY is configured", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";

    const module = await loadOpenRouterService();
    const firstClient = module.getOpenRouterClient();
    const secondClient = module.getOpenRouterClient();

    expect(firstClient).toBeDefined();
    expect(secondClient).toBe(firstClient);
  });
});
