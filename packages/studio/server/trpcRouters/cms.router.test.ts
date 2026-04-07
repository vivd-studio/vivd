import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context.js";

const { touchMock, requestBucketSyncMock } = vi.hoisted(() => ({
  touchMock: vi.fn(),
  requestBucketSyncMock: vi.fn(() => true),
}));

vi.mock("../services/reporting/ProjectTouchReporter.js", () => ({
  projectTouchReporter: {
    touch: touchMock,
  },
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSync: requestBucketSyncMock,
}));

import { cmsRouter } from "./cms.js";

function makeContext(projectDir: string): Context {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => projectDir),
    } as unknown as Context["workspace"],
  };
}

describe("cms router", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-cms-router-"));
    touchMock.mockReset();
    requestBucketSyncMock.mockReset();
    requestBucketSyncMock.mockReturnValue(true);
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it("initializes the CMS workspace and builds empty artifacts", async () => {
    const caller = cmsRouter.createCaller(makeContext(projectDir));

    const result = await caller.init({
      slug: "demo-site",
      version: 1,
    });

    expect(result.report.initialized).toBe(true);
    expect(result.report.valid).toBe(true);
    expect(result.built).toBe(true);
    await expect(
      fs.stat(path.join(projectDir, "src/content/vivd.content.yaml")),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectDir, ".vivd/content/manifest.json")),
    ).resolves.toBeDefined();
    expect(touchMock).toHaveBeenCalledWith("demo-site");
    expect(requestBucketSyncMock).toHaveBeenCalledWith("cms-initialized", {
      slug: "demo-site",
      version: 1,
    });
  });

  it("scaffolds a model and entry and returns them in status order", async () => {
    const caller = cmsRouter.createCaller(makeContext(projectDir));

    await caller.init({ slug: "demo-site", version: 1 });
    await caller.scaffoldModel({
      slug: "demo-site",
      version: 1,
      modelKey: "products",
    });
    const result = await caller.scaffoldEntry({
      slug: "demo-site",
      version: 1,
      modelKey: "products",
      entryKey: "alpine-boot",
    });

    expect(result.report.valid).toBe(true);
    expect(result.built).toBe(true);
    expect(result.report.models).toHaveLength(1);
    expect(result.report.models[0]?.key).toBe("products");
    expect(result.report.models[0]?.entries[0]?.key).toBe("alpine-boot");
    expect(result.report.models[0]?.entries[0]?.values).toMatchObject({
      slug: "alpine-boot",
      status: "active",
      sortOrder: 0,
      title: {
        en: "Alpine Boot",
      },
    });
  });
});
