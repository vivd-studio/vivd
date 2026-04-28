import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context.js";

const {
  createImageGenerationMock,
  extractImageFromResponseMock,
  projectTouchMock,
  requestBucketSyncMock,
} = vi.hoisted(() => ({
  createImageGenerationMock: vi.fn(),
  extractImageFromResponseMock: vi.fn(),
  projectTouchMock: vi.fn(),
  requestBucketSyncMock: vi.fn(),
}));

vi.mock("../services/integrations/OpenRouterImageService.js", () => ({
  createImageGeneration: createImageGenerationMock,
  extractImageFromResponse: extractImageFromResponseMock,
}));

vi.mock("../services/reporting/ProjectTouchReporter.js", () => ({
  projectTouchReporter: {
    touch: projectTouchMock,
  },
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSync: requestBucketSyncMock,
}));

import { assetsRouter } from "./assets.js";

function makeContext(projectDir: string): Context {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => projectDir),
    } as unknown as Context["workspace"],
  };
}

describe("assets router AI image flows", () => {
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const samplePngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6V7kQAAAAASUVORK5CYII=";
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-assets-router-"));
    process.env.OPENROUTER_API_KEY = "test-key";

    createImageGenerationMock.mockReset();
    extractImageFromResponseMock.mockReset();
    projectTouchMock.mockReset();
    requestBucketSyncMock.mockReset();

    createImageGenerationMock.mockResolvedValue({
      data: { id: "generation-1" },
    });
    extractImageFromResponseMock.mockReturnValue(
      `data:image/png;base64,${samplePngBase64}`,
    );
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    if (typeof originalApiKey === "string") {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("saves generated images into the requested asset folder", async () => {
    await fs.mkdir(path.join(projectDir, "public/images"), { recursive: true });
    const caller = assetsRouter.createCaller(makeContext(projectDir));

    const result = await caller.createImageWithAI({
      slug: "demo",
      version: 1,
      prompt: "Clean hero image",
      referenceImages: [],
      targetPath: "public/images",
    });

    expect(result.path).toMatch(
      /^public\/images\/ai-clean-hero-image-\d+\.webp$/,
    );
    await expect(fs.stat(path.join(projectDir, result.path))).resolves.toBeDefined();
    await expect(fs.stat(path.join(projectDir, result.fileName))).rejects.toThrow();
    expect(projectTouchMock).toHaveBeenCalledWith("demo");
    expect(requestBucketSyncMock).toHaveBeenCalledWith("image-ai-created", {
      slug: "demo",
      version: 1,
      path: result.path,
    });
  });

  it("defaults generated Astro images into shared managed media", async () => {
    await fs.writeFile(path.join(projectDir, "astro.config.mjs"), "export default {};\n");
    const caller = assetsRouter.createCaller(makeContext(projectDir));

    const result = await caller.createImageWithAI({
      slug: "demo",
      version: 1,
      prompt: "Clean hero image",
      referenceImages: [],
      targetPath: "",
    });

    expect(result.path).toMatch(
      /^src\/content\/media\/shared\/ai-clean-hero-image-\d+\.webp$/,
    );
    await expect(fs.stat(path.join(projectDir, result.path))).resolves.toBeDefined();
    expect(requestBucketSyncMock).toHaveBeenCalledWith("image-ai-created", {
      slug: "demo",
      version: 1,
      path: result.path,
    });
  });

  it("saves AI edit candidates next to the source image", async () => {
    const sourceRelativePath = "src/content/media/horse/hero.png";
    const sourcePath = path.join(projectDir, sourceRelativePath);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.from(samplePngBase64, "base64"));
    const caller = assetsRouter.createCaller(makeContext(projectDir));

    const result = await caller.editImageWithAI({
      slug: "demo",
      version: 1,
      relativePath: sourceRelativePath,
      prompt: "Make it brighter",
    });

    expect(result.newPath).toBe("src/content/media/horse/hero-ai-edited.webp");
    await expect(fs.stat(path.join(projectDir, result.newPath))).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectDir, "hero-ai-edited.webp")),
    ).rejects.toThrow();
    expect(projectTouchMock).toHaveBeenCalledWith("demo");
    expect(requestBucketSyncMock).toHaveBeenCalledWith("image-ai-edited", {
      slug: "demo",
      version: 1,
      originalPath: sourceRelativePath,
      newPath: result.newPath,
    });
  });
});
