import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOpencodeClientMock,
  execSyncMock,
  spawnMock,
  spawnSyncMock,
  treeKillMock,
} = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn(),
  execSyncMock: vi.fn(() => ""),
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(() => ({ error: undefined })),
  treeKillMock: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: createOpencodeClientMock,
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
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

describe("serverManager workspace readiness", () => {
  beforeEach(() => {
    vi.resetModules();
    createOpencodeClientMock.mockReset();
    execSyncMock.mockReset();
    execSyncMock.mockReturnValue("");
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation(() => ({ error: undefined }));
    treeKillMock.mockReset();
    process.env.OPENCODE_KILL_ORPHANS = "0";
    process.env.OPENCODE_IDLE_TIMEOUT_MS = "0";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("warms workspace-scoped readiness endpoints before returning a client", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      body: {
        cancel: vi.fn(),
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const proc = {
      pid: 123,
      exitCode: null,
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn((event: string, callback: () => void) => {
        if (event === "spawn") {
          queueMicrotask(callback);
        }
        return proc;
      }),
      unref: vi.fn(),
    };
    spawnMock.mockReturnValue(proc);
    createOpencodeClientMock.mockReturnValue("client");

    const { serverManager } = await import("./serverManager.js");
    const result = await serverManager.getClientAndDirectory("/tmp/project");

    const workspaceDir = path.resolve("/tmp/project");
    expect(result).toEqual({
      client: "client",
      directory: workspaceDir,
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:4096/config",
      `http://127.0.0.1:4096/path?directory=${encodeURIComponent(workspaceDir)}`,
      `http://127.0.0.1:4096/session/status?directory=${encodeURIComponent(workspaceDir)}`,
    ]);
    expect(createOpencodeClientMock).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4096",
      directory: workspaceDir,
    });
  });
});
