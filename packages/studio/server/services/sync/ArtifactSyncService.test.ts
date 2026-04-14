import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock, detectProjectTypeMock, hasNodeModulesMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
  hasNodeModulesMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: spawnSyncMock,
}));

vi.mock("../project/projectType.js", () => ({
  detectProjectType: detectProjectTypeMock,
  hasNodeModules: hasNodeModulesMock,
}));

import {
  buildAndUploadPreview,
  syncSourceToBucket,
} from "./ArtifactSyncService.js";

const ENV_KEYS = [
  "VIVD_S3_BUCKET",
  "R2_BUCKET",
  "VIVD_S3_ENDPOINT_URL",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY",
  "R2_SECRET_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "VIVD_S3_PREFIX",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function restoreEnv() {
  for (const [key, value] of originalEnv) {
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
}

describe("ArtifactSyncService", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    detectProjectTypeMock.mockReset();
    hasNodeModulesMock.mockReset();
    restoreEnv();
    detectProjectTypeMock.mockReturnValue({
      framework: "generic",
      packageManager: "npm",
    });
  });

  afterEach(() => {
    restoreEnv();
  });

  it("returns early for source sync when bucket is not configured", async () => {
    delete process.env.VIVD_S3_BUCKET;
    delete process.env.R2_BUCKET;

    const tempProject = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-source-sync-"));
    await fs.writeFile(path.join(tempProject, "index.html"), "<html></html>", "utf-8");

    await expect(
      syncSourceToBucket({
        projectDir: tempProject,
        slug: "site-1",
        version: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("skips preview upload for non-Astro projects", async () => {
    process.env.VIVD_S3_BUCKET = "test-bucket";
    detectProjectTypeMock.mockReturnValue({
      framework: "generic",
      packageManager: "npm",
    });

    const tempProject = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-preview-sync-"));
    await fs.writeFile(path.join(tempProject, "index.html"), "<html></html>", "utf-8");

    await expect(
      buildAndUploadPreview({
        projectDir: tempProject,
        slug: "site-1",
        version: 1,
      }),
    ).resolves.toBeUndefined();

    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when SDK sync is unavailable and AWS CLI is missing", async () => {
    process.env.VIVD_S3_BUCKET = "test-bucket";
    spawnSyncMock.mockReturnValue({
      status: 1,
      error: { code: "ENOENT" },
    });

    const tempProject = await fs.mkdtemp(path.join(os.tmpdir(), "vivd-source-sync-fail-"));
    await fs.writeFile(path.join(tempProject, "index.html"), "<html></html>", "utf-8");

    await expect(
      syncSourceToBucket({
        projectDir: tempProject,
        slug: "site-1",
        version: 1,
        commitHash: "abc123",
      }),
    ).rejects.toThrow("AWS CLI is not installed");
  });
});
