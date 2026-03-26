import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOpencodeClientMock,
  execSyncMock,
  spawnSyncMock,
  treeKillMock,
} = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn(),
  execSyncMock: vi.fn(() => ""),
  spawnSyncMock: vi.fn(() => ({ error: undefined })),
  treeKillMock: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: createOpencodeClientMock,
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execSync: execSyncMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("tree-kill", () => ({
  default: treeKillMock,
}));

const ORIGINAL_ENV = {
  OPENCODE_KILL_ORPHANS: process.env.OPENCODE_KILL_ORPHANS,
  OPENCODE_IDLE_TIMEOUT_MS: process.env.OPENCODE_IDLE_TIMEOUT_MS,
};

describe("serverManager shutdown", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    createOpencodeClientMock.mockReset();
    execSyncMock.mockReset();
    execSyncMock.mockReturnValue("");
    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation(() => ({ error: undefined }));
    treeKillMock.mockReset();
    process.env.OPENCODE_KILL_ORPHANS = "0";
    process.env.OPENCODE_IDLE_TIMEOUT_MS = "0";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (typeof ORIGINAL_ENV.OPENCODE_KILL_ORPHANS === "string") {
      process.env.OPENCODE_KILL_ORPHANS = ORIGINAL_ENV.OPENCODE_KILL_ORPHANS;
    } else {
      delete process.env.OPENCODE_KILL_ORPHANS;
    }
    if (typeof ORIGINAL_ENV.OPENCODE_IDLE_TIMEOUT_MS === "string") {
      process.env.OPENCODE_IDLE_TIMEOUT_MS = ORIGINAL_ENV.OPENCODE_IDLE_TIMEOUT_MS;
    } else {
      delete process.env.OPENCODE_IDLE_TIMEOUT_MS;
    }
  });

  it("waits for opencode child shutdown before resolving closeAll", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(((pid, signal) => {
      if (signal === 0) throw new Error(`process ${pid} exited`);
      return true;
    }) as typeof process.kill);

    let termCallback: ((error?: Error | null) => void) | undefined;
    treeKillMock.mockImplementation((_pid, _signal, callback) => {
      termCallback = callback;
    });

    const { serverManager } = await import("./serverManager.js");
    const manager = serverManager as unknown as {
      servers: Map<string, {
        url: string;
        process: { pid?: number };
        port: number;
        lastActivity: number;
        directory: string;
      }>;
    };

    manager.servers.set("/tmp/project", {
      url: "http://127.0.0.1:4096",
      process: { pid: 123 },
      port: 4096,
      lastActivity: Date.now(),
      directory: "/tmp/project",
    });

    let settled = false;
    const closePromise = Promise.resolve(serverManager.closeAll()).then(() => {
      settled = true;
    });

    expect(treeKillMock).toHaveBeenCalledWith(123, "SIGTERM", expect.any(Function));
    await Promise.resolve();
    expect(settled).toBe(false);

    termCallback?.(undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    await closePromise;

    expect(settled).toBe(true);
    expect(processKillSpy).toHaveBeenCalledWith(123, 0);
    expect(manager.servers.size).toBe(0);
  });
});
