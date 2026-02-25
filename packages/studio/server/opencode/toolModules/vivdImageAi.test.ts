import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isConnectedModeMock, fetchStatusMock, reportImageGenerationMock, createImageGenerationMock } =
  vi.hoisted(() => ({
    isConnectedModeMock: vi.fn(),
    fetchStatusMock: vi.fn(),
    reportImageGenerationMock: vi.fn(),
    createImageGenerationMock: vi.fn(),
  }));

vi.mock("@vivd/shared", () => ({
  isConnectedMode: isConnectedModeMock,
}));

vi.mock("../../services/reporting/UsageReporter.js", () => ({
  usageReporter: {
    fetchStatus: fetchStatusMock,
    reportImageGeneration: reportImageGenerationMock,
  },
}));

vi.mock("../../services/integrations/OpenRouterImageService.js", () => ({
  createImageGeneration: createImageGenerationMock,
  extractImageFromResponse: vi.fn(() => null),
}));

import { vivdImageAiToolDefinition } from "./vivdImageAi.js";

describe("vivdImageAiToolDefinition", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    isConnectedModeMock.mockReset();
    fetchStatusMock.mockReset();
    reportImageGenerationMock.mockReset();
    createImageGenerationMock.mockReset();

    isConnectedModeMock.mockReturnValue(true);
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalApiKey;
  });

  it("returns a limit error and skips provider calls when image generation is blocked", async () => {
    fetchStatusMock.mockResolvedValue({
      blocked: false,
      imageGenBlocked: true,
      warnings: ["Monthly image generation limit reached (25/25). Resets on the 1st."],
      usage: {
        daily: { current: 0, limit: 1000, percentage: 0 },
        weekly: { current: 0, limit: 2500, percentage: 0 },
        monthly: { current: 0, limit: 5000, percentage: 0 },
        imageGen: { current: 25, limit: 25, percentage: 1 },
      },
      nextReset: {
        daily: new Date().toISOString(),
        weekly: new Date().toISOString(),
        monthly: new Date().toISOString(),
      },
    });

    const raw = await vivdImageAiToolDefinition.execute(
      {
        prompt: "Generate a hero image",
        images: [],
        operation: "create",
        outputDir: "",
      },
      { directory: "/tmp" },
    );

    const result = JSON.parse(raw);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("IMAGE_GEN_LIMIT_EXCEEDED");
    expect(String(result.error?.message)).toContain("image generation limit");
    expect(createImageGenerationMock).not.toHaveBeenCalled();
  });

  it("returns a limit-check error when connected mode cannot fetch status", async () => {
    fetchStatusMock.mockResolvedValue(null);

    const raw = await vivdImageAiToolDefinition.execute(
      {
        prompt: "Generate a hero image",
        images: [],
        operation: "create",
        outputDir: "",
      },
      { directory: "/tmp" },
    );

    const result = JSON.parse(raw);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("IMAGE_GEN_LIMIT_EXCEEDED");
    expect(String(result.error?.message)).toContain("Unable to verify usage limits");
    expect(createImageGenerationMock).not.toHaveBeenCalled();
  });
});
