import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createOpencodeClientMock } = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn(),
}));

vi.mock("@opencode-ai/sdk", () => ({
  createOpencodeClient: createOpencodeClientMock,
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  spawnSync: vi.fn(() => ({ error: new Error("missing") })),
}));

vi.mock("tree-kill", () => ({
  default: vi.fn(),
}));

const ORIGINAL_ENV = {
  OPENCODE_KILL_ORPHANS: process.env.OPENCODE_KILL_ORPHANS,
  OPENCODE_IDLE_TIMEOUT_MS: process.env.OPENCODE_IDLE_TIMEOUT_MS,
};

describe("serverManager missing opencode binary", () => {
  beforeEach(() => {
    vi.resetModules();
    createOpencodeClientMock.mockReset();
    process.env.OPENCODE_KILL_ORPHANS = "0";
    process.env.OPENCODE_IDLE_TIMEOUT_MS = "0";
  });

  afterEach(() => {
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

  it("throws a clear error before client creation when opencode is unavailable", async () => {
    const { serverManager } = await import("./serverManager.js");

    await expect(serverManager.getClientAndDirectory("/tmp/project")).rejects.toThrow(
      'Cannot start server because "opencode" was not found in PATH',
    );
    expect(createOpencodeClientMock).not.toHaveBeenCalled();
  });
});
