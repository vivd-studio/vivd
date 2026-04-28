import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  isConnectedModeMock,
  fetchStatusMock,
  reportImageGenerationMock,
  createImageGenerationMock,
  extractImageFromResponseMock,
  projectTouchMock,
  requestBucketSyncMock,
} = vi.hoisted(() => ({
  isConnectedModeMock: vi.fn(),
  fetchStatusMock: vi.fn(),
  reportImageGenerationMock: vi.fn(),
  createImageGenerationMock: vi.fn(),
  extractImageFromResponseMock: vi.fn(),
  projectTouchMock: vi.fn(),
  requestBucketSyncMock: vi.fn(),
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

vi.mock("../../services/reporting/ProjectTouchReporter.js", () => ({
  projectTouchReporter: {
    touch: projectTouchMock,
  },
}));

vi.mock("../../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSync: requestBucketSyncMock,
}));

vi.mock("../../services/integrations/OpenRouterImageService.js", () => ({
  createImageGeneration: createImageGenerationMock,
  extractImageFromResponse: extractImageFromResponseMock,
}));

import { vivdImageAiToolDefinition } from "./vivdImageAi.js";

describe("vivdImageAiToolDefinition", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalProjectSlug = process.env.VIVD_PROJECT_SLUG;
  const originalProjectVersion = process.env.VIVD_PROJECT_VERSION;
  const originalImageAiMaxParallel =
    process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL;
  const samplePngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6V7kQAAAAASUVORK5CYII=";

  beforeEach(() => {
    isConnectedModeMock.mockReset();
    fetchStatusMock.mockReset();
    reportImageGenerationMock.mockReset();
    createImageGenerationMock.mockReset();
    extractImageFromResponseMock.mockReset();
    projectTouchMock.mockReset();
    requestBucketSyncMock.mockReset();

    isConnectedModeMock.mockReturnValue(true);
    process.env.OPENROUTER_API_KEY = "test-key";
    delete process.env.VIVD_PROJECT_SLUG;
    delete process.env.VIVD_PROJECT_VERSION;
    delete process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL;
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalApiKey;
    process.env.VIVD_PROJECT_SLUG = originalProjectSlug;
    process.env.VIVD_PROJECT_VERSION = originalProjectVersion;
    if (typeof originalImageAiMaxParallel === "string") {
      process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL =
        originalImageAiMaxParallel;
    } else {
      delete process.env.STUDIO_OPENCODE_IMAGE_AI_MAX_PARALLEL;
    }
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
    expect(String(result.error?.message)).toContain("Unable to verify Studio usage status");
    expect(createImageGenerationMock).not.toHaveBeenCalled();
  });

  it("defaults create outputs to src/content/media for Astro workspaces", async () => {
    isConnectedModeMock.mockReturnValue(false);
    createImageGenerationMock.mockResolvedValue({
      data: { id: "gen_astro_1" },
      generationId: "gen_astro_1",
    });
    extractImageFromResponseMock.mockReturnValue(`data:image/png;base64,${samplePngBase64}`);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-image-ai-astro-"));
    fs.writeFileSync(path.join(workspaceDir, "astro.config.mjs"), "export default {};\n", "utf-8");

    try {
      const raw = await vivdImageAiToolDefinition.execute(
        {
          prompt: "Generate an urban hero image",
          images: [],
          operation: "create",
          outputDir: "",
        },
        { directory: workspaceDir },
      );

      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(result.output.path.startsWith("src/content/media/shared/")).toBe(true);
      expect(fs.existsSync(path.join(workspaceDir, result.output.path))).toBe(true);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("returns success even when usage report submission fails", async () => {
    isConnectedModeMock.mockReturnValue(true);
    fetchStatusMock.mockResolvedValue({
      blocked: false,
      imageGenBlocked: false,
      warnings: [],
      usage: {
        daily: { current: 0, limit: 1000, percentage: 0 },
        weekly: { current: 0, limit: 2500, percentage: 0 },
        monthly: { current: 0, limit: 5000, percentage: 0 },
        imageGen: { current: 1, limit: 25, percentage: 0.04 },
      },
      nextReset: {
        daily: new Date().toISOString(),
        weekly: new Date().toISOString(),
        monthly: new Date().toISOString(),
      },
    });
    reportImageGenerationMock.mockRejectedValue(new Error("backend timeout"));
    createImageGenerationMock.mockResolvedValue({
      data: { id: "gen_usage_fail_1" },
      generationId: "gen_usage_fail_1",
    });
    extractImageFromResponseMock.mockReturnValue(`data:image/png;base64,${samplePngBase64}`);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-image-ai-usage-"));

    try {
      const raw = await vivdImageAiToolDefinition.execute(
        {
          prompt: "Generate an image despite usage reporter issues",
          images: [],
          operation: "create",
          outputDir: "",
        },
        { directory: workspaceDir },
      );

      const result = JSON.parse(raw);
      expect(result.ok).toBe(true);
      expect(reportImageGenerationMock).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(path.join(workspaceDir, result.output.path))).toBe(true);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("queues image generations so no more than three run in parallel by default", async () => {
    isConnectedModeMock.mockReturnValue(false);

    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    let generationIndex = 0;

    createImageGenerationMock.mockImplementation(() => {
      generationIndex += 1;
      const currentIndex = generationIndex;
      active += 1;
      maxActive = Math.max(maxActive, active);

      return new Promise((resolve) => {
        releases.push(() => {
          active -= 1;
          resolve({
            data: { id: `gen_${currentIndex}` },
            generationId: `gen_${currentIndex}`,
          });
        });
      });
    });
    extractImageFromResponseMock.mockReturnValue(`data:image/png;base64,${samplePngBase64}`);

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-image-ai-queue-"));

    const waitForCallCount = async (expected: number) => {
      for (let index = 0; index < 50; index += 1) {
        if (createImageGenerationMock.mock.calls.length >= expected) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(createImageGenerationMock.mock.calls.length).toBeGreaterThanOrEqual(expected);
    };

    try {
      const runs = Array.from({ length: 4 }, (_, index) =>
        vivdImageAiToolDefinition.execute(
          {
            prompt: `Generate hero image ${index + 1}`,
            images: [],
            operation: "create",
            outputDir: "",
          },
          { directory: workspaceDir },
        ),
      );

      await waitForCallCount(3);
      expect(createImageGenerationMock).toHaveBeenCalledTimes(3);
      expect(maxActive).toBe(3);

      releases.shift()?.();
      await waitForCallCount(4);
      expect(createImageGenerationMock).toHaveBeenCalledTimes(4);

      while (releases.length > 0) {
        releases.shift()?.();
      }

      const results = (await Promise.all(runs)).map((raw) => JSON.parse(raw));
      expect(results.every((entry) => entry.ok === true)).toBe(true);
      expect(maxActive).toBe(3);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
