import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  execSyncMock,
  detectProjectTypeMock,
  hasNodeModulesMock,
  ensureReferencedAstroCmsToolkitMock,
} = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
  hasNodeModulesMock: vi.fn(),
  ensureReferencedAstroCmsToolkitMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: execSyncMock,
}));

vi.mock("../src/devserver/projectType", () => ({
  detectProjectType: detectProjectTypeMock,
  hasNodeModules: hasNodeModulesMock,
}));

vi.mock("@vivd/shared/cms", () => ({
  ensureReferencedAstroCmsToolkit: ensureReferencedAstroCmsToolkitMock,
}));

import { buildService } from "../src/services/project/BuildService";

const tmpDirs = new Set<string>();

function createProjectDir(): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-build-service-"));
  tmpDirs.add(projectDir);
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ scripts: { build: "astro build" } }),
    "utf-8",
  );
  fs.writeFileSync(path.join(projectDir, "package-lock.json"), "{}", "utf-8");
  return projectDir;
}

describe("BuildService", () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    detectProjectTypeMock.mockReset();
    hasNodeModulesMock.mockReset();
    ensureReferencedAstroCmsToolkitMock.mockReset();

    detectProjectTypeMock.mockReturnValue({
      framework: "astro",
      packageManager: "npm",
    });
    hasNodeModulesMock.mockReturnValue(false);
    ensureReferencedAstroCmsToolkitMock.mockResolvedValue(null);
  });

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.clear();
  });

  it("retries npm install without package-lock when esbuild native install mismatches", async () => {
    const projectDir = createProjectDir();
    const lockPath = path.join(projectDir, "package-lock.json");
    let lockMissingAtRetry = false;

    execSyncMock
      .mockImplementationOnce(() => {
        throw new Error(
          'npm error path node_modules/esbuild\nError: Expected "0.25.12" but got "0.27.4"',
        );
      })
      .mockImplementationOnce(() => {
        lockMissingAtRetry = !fs.existsSync(lockPath);
      })
      .mockImplementationOnce((_cmd: string) => {
        const distDir = path.join(projectDir, "dist");
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>", "utf-8");
      });

    const outputPath = await buildService.buildSync(projectDir, "dist");

    expect(outputPath).toBe(path.join(projectDir, "dist"));
    expect(lockMissingAtRetry).toBe(true);
    expect(execSyncMock).toHaveBeenNthCalledWith(
      1,
      "npm install --include=optional",
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(execSyncMock).toHaveBeenNthCalledWith(
      2,
      "npm install --include=optional",
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(execSyncMock.mock.calls[2]?.[0]).toContain("astro");
  });
});
