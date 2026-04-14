import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnSyncMock, detectProjectTypeMock, hasNodeModulesMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(() => ({ status: 0 })),
  detectProjectTypeMock: vi.fn(),
  hasNodeModulesMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: spawnSyncMock,
}));

vi.mock("./projectType.js", () => ({
  detectProjectType: detectProjectTypeMock,
  hasNodeModules: hasNodeModulesMock,
}));

vi.mock("tree-kill", () => ({
  default: vi.fn((_pid: number, _signal: string, callback?: (error?: Error) => void) => {
    callback?.();
  }),
}));

import { DevServerService } from "./DevServerService.js";

describe("DevServerService", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
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
});
