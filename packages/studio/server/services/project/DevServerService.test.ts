import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  spawnMock,
  spawnSyncMock,
  detectProjectTypeMock,
  hasNodeModulesMock,
  ensureAstroCmsToolkitMock,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(() => ({ status: 0 })),
  detectProjectTypeMock: vi.fn(),
  hasNodeModulesMock: vi.fn(),
  ensureAstroCmsToolkitMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("./projectType.js", () => ({
  detectProjectType: detectProjectTypeMock,
  hasNodeModules: hasNodeModulesMock,
}));

vi.mock("./astroCmsToolkit.js", () => ({
  ensureAstroCmsToolkit: ensureAstroCmsToolkitMock,
}));

vi.mock("tree-kill", () => ({
  default: vi.fn((_pid: number, _signal: string, callback?: (error?: Error) => void) => {
    callback?.();
  }),
}));

import { DevServerService } from "./DevServerService.js";

const tmpDirs = new Set<string>();

function createTempProjectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-devserver-test-"));
  tmpDirs.add(dir);
  return dir;
}

function mockSpawnExit(options?: {
  code?: number;
  stdout?: string;
  stderr?: string;
  onStart?: () => void;
}) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  queueMicrotask(() => {
    options?.onStart?.();
    if (options?.stdout) {
      proc.stdout.emit("data", Buffer.from(options.stdout));
    }
    if (options?.stderr) {
      proc.stderr.emit("data", Buffer.from(options.stderr));
    }
    proc.emit("exit", options?.code ?? 0);
  });

  return proc;
}

describe("DevServerService", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.clear();
  });

  it("keeps same-project error state until an explicit restart is requested", async () => {
    const service = new DevServerService();
    const stopSpy = vi.spyOn(service as any, "stopDevServer");

    (service as any).server = {
      url: "http://127.0.0.1:5100",
      process: { pid: 1234 } as any,
      port: 5100,
      projectDir: "/tmp/project",
      basePath: "/",
      lastActivity: 0,
      status: "error",
      error: "npm error code ERESOLVE",
    };

    const result = await service.getOrStartDevServer("/tmp/project", "/");

    expect(result).toEqual({
      url: null,
      status: "error",
      error: "npm error code ERESOLVE",
    });
    expect(stopSpy).not.toHaveBeenCalled();

    await service.close();
  });

  it("removes npm lockfile when a clean restart requests a reinstall", async () => {
    const service = new DevServerService();
    const projectDir = createTempProjectDir();
    fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "package.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(projectDir, "package-lock.json"), "{}", "utf-8");

    detectProjectTypeMock.mockReturnValue({
      framework: "astro",
      mode: "devserver",
      packageManager: "npm",
      devCommand: "astro dev",
    });
    const getOrStartSpy = vi
      .spyOn(service, "getOrStartDevServer")
      .mockResolvedValue({ url: null, status: "installing" });

    await service.restartDevServer(projectDir, "/", { clean: true });

    expect(fs.existsSync(path.join(projectDir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, "package-lock.json"))).toBe(false);
    expect(getOrStartSpy).toHaveBeenCalledWith(projectDir, "/");

    await service.close();
  });

  it("repairs missing npm Rollup optional native dependencies after stale lock install", async () => {
    const service = new DevServerService();
    const projectDir = createTempProjectDir();
    const lockPath = path.join(projectDir, "package-lock.json");
    let lockMissingAtRepair = false;

    fs.mkdirSync(path.join(projectDir, "node_modules", "rollup"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ dependencies: { rollup: "4.0.0" } }),
      "utf-8",
    );
    fs.writeFileSync(lockPath, "{}", "utf-8");
    fs.writeFileSync(
      path.join(projectDir, "node_modules", "rollup", "package.json"),
      "{}",
      "utf-8",
    );

    hasNodeModulesMock.mockReturnValue(false);
    spawnMock
      .mockImplementationOnce(() => mockSpawnExit())
      .mockImplementationOnce(() =>
        mockSpawnExit({
          code: 1,
          stderr:
            "Error: Cannot find module '@rollup/rollup-linux-x64-gnu'\ncode: 'MODULE_NOT_FOUND'",
        }),
      )
      .mockImplementationOnce(() =>
        mockSpawnExit({
          onStart: () => {
            lockMissingAtRepair = !fs.existsSync(lockPath);
            fs.writeFileSync(lockPath, "{}", "utf-8");
            fs.mkdirSync(path.join(projectDir, "node_modules", "rollup"), {
              recursive: true,
            });
            fs.writeFileSync(
              path.join(projectDir, "node_modules", "rollup", "package.json"),
              "{}",
              "utf-8",
            );
          },
        }),
      )
      .mockImplementationOnce(() => mockSpawnExit());

    const serverInfo = {
      url: "http://127.0.0.1:5100",
      process: null,
      port: 5100,
      projectDir,
      basePath: "/",
      lastActivity: Date.now(),
      status: "installing",
    };
    (service as any).server = serverInfo;
    const spawnDevServerSpy = vi
      .spyOn(service as any, "spawnDevServer")
      .mockResolvedValue(undefined);

    await (service as any).startServerAsync(
      projectDir,
      {
        framework: "astro",
        mode: "devserver",
        packageManager: "npm",
        devCommand: "astro dev",
      },
      5100,
      "/",
      serverInfo,
    );

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["ci", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "node",
      ["-e", "require('rollup')"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "npm",
      ["install", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      "node",
      ["-e", "require('rollup')"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(lockMissingAtRepair).toBe(true);
    expect(spawnDevServerSpy).toHaveBeenCalledOnce();

    await service.close();
  });

  it("repairs npm install when esbuild native binary postinstall mismatches", async () => {
    const service = new DevServerService();
    const projectDir = createTempProjectDir();
    const lockPath = path.join(projectDir, "package-lock.json");
    let lockMissingAtRepair = false;

    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ dependencies: { esbuild: "0.25.12" } }),
      "utf-8",
    );
    fs.writeFileSync(lockPath, "{}", "utf-8");

    hasNodeModulesMock.mockReturnValue(false);
    spawnMock
      .mockImplementationOnce(() =>
        mockSpawnExit({
          code: 1,
          stderr:
            'npm error path node_modules/esbuild\nError: Expected "0.25.12" but got "0.27.4"',
        }),
      )
      .mockImplementationOnce(() =>
        mockSpawnExit({
          onStart: () => {
            lockMissingAtRepair = !fs.existsSync(lockPath);
            fs.writeFileSync(lockPath, "{}", "utf-8");
            fs.mkdirSync(path.join(projectDir, "node_modules", "esbuild"), {
              recursive: true,
            });
            fs.writeFileSync(
              path.join(projectDir, "node_modules", "esbuild", "package.json"),
              "{}",
              "utf-8",
            );
          },
        }),
      )
      .mockImplementationOnce(() => mockSpawnExit());

    const serverInfo = {
      url: "http://127.0.0.1:5100",
      process: null,
      port: 5100,
      projectDir,
      basePath: "/",
      lastActivity: Date.now(),
      status: "installing",
    };
    (service as any).server = serverInfo;
    const spawnDevServerSpy = vi
      .spyOn(service as any, "spawnDevServer")
      .mockResolvedValue(undefined);

    await (service as any).startServerAsync(
      projectDir,
      {
        framework: "astro",
        mode: "devserver",
        packageManager: "npm",
        devCommand: "astro dev",
      },
      5100,
      "/",
      serverInfo,
    );

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["ci", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["install", "--include=optional", "--prefer-offline", "--no-audit", "--no-fund"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "node",
      ["-e", "const esbuild=require('esbuild');esbuild.transformSync('let x=1')"],
      expect.objectContaining({ cwd: projectDir }),
    );
    expect(lockMissingAtRepair).toBe(true);
    expect(spawnDevServerSpy).toHaveBeenCalledOnce();

    await service.close();
  });
});
