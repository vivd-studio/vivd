import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getClientAndDirectoryMock,
  sessionListMock,
  sessionStatusMock,
  sessionAbortMock,
  getSessionStatusesMock,
  setSessionStatusMock,
  emitSessionEventMock,
  createAgentEventMock,
} = vi.hoisted(() => ({
  getClientAndDirectoryMock: vi.fn(),
  sessionListMock: vi.fn(),
  sessionStatusMock: vi.fn(),
  sessionAbortMock: vi.fn(),
  getSessionStatusesMock: vi.fn(),
  setSessionStatusMock: vi.fn(),
  emitSessionEventMock: vi.fn(),
  createAgentEventMock: vi.fn((_sessionId, _type, payload) => payload),
}));

vi.mock("./serverManager.js", () => ({
  serverManager: {
    getClientAndDirectory: getClientAndDirectoryMock,
  },
}));

vi.mock("./eventEmitter.js", () => ({
  agentEventEmitter: {
    getSessionStatuses: getSessionStatusesMock,
    setSessionStatus: setSessionStatusMock,
    emitSessionEvent: emitSessionEventMock,
  },
  createAgentEvent: createAgentEventMock,
}));

vi.mock("./useEvents.js", () => ({
  useEvents: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("./modelConfig.js", () => ({
  getDefaultModel: vi.fn(() => ({ provider: "test-provider", modelId: "test-model" })),
  getAvailableModels: vi.fn(() => []),
}));

vi.mock("../services/reporting/UsageReporter.js", () => ({
  usageReporter: {
    report: vi.fn(),
    updateSessionTitle: vi.fn(),
  },
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSyncAfterAgentTask: vi.fn(),
}));

import { abortSession, getSessionsStatus, listSessions } from "./index.js";

describe("opencode index session behavior", () => {
  beforeEach(() => {
    getClientAndDirectoryMock.mockReset();
    sessionListMock.mockReset();
    sessionStatusMock.mockReset();
    sessionAbortMock.mockReset();
    getSessionStatusesMock.mockReset();
    setSessionStatusMock.mockReset();
    emitSessionEventMock.mockReset();
    createAgentEventMock.mockClear();

    sessionListMock.mockResolvedValue({ data: [], error: undefined });
    sessionStatusMock.mockResolvedValue({ data: {}, error: undefined });
    sessionAbortMock.mockResolvedValue({ data: {}, error: undefined });
    getSessionStatusesMock.mockReturnValue({});

    getClientAndDirectoryMock.mockResolvedValue({
      directory: "/workspace/project/",
      client: {
        session: {
          list: sessionListMock,
          status: sessionStatusMock,
          abort: sessionAbortMock,
        },
      },
    });
  });

  it("filters sessions to the current opencode directory (with trailing-slash tolerance)", async () => {
    sessionListMock.mockResolvedValueOnce({
      data: [
        { id: "sess-1", directory: "/workspace/project" },
        { id: "sess-2", directory: "/workspace/project/" },
        { id: "sess-3", directory: "/other/project" },
        { id: "sess-4" },
      ],
      error: undefined,
    });

    const result = await listSessions("/workspace/project");

    expect(result).toEqual([
      { id: "sess-1", directory: "/workspace/project" },
      { id: "sess-2", directory: "/workspace/project/" },
    ]);
  });

  it("merges backend statuses with emitter overrides for known sessions only", async () => {
    sessionListMock.mockResolvedValueOnce({
      data: [
        { id: "sess-1", directory: "/workspace/project/" },
        { id: "sess-2", directory: "/workspace/project/" },
      ],
      error: undefined,
    });
    sessionStatusMock.mockResolvedValueOnce({
      data: {
        "sess-1": { type: "busy" },
        "sess-2": { type: "idle" },
        "sess-ghost": { type: "busy" },
      },
      error: undefined,
    });
    getSessionStatusesMock.mockReturnValueOnce({
      "sess-2": { type: "busy" },
      "sess-ghost": { type: "idle" },
    });

    const result = await getSessionsStatus("/workspace/project");

    expect(result).toEqual({
      "sess-1": { type: "busy" },
      "sess-2": { type: "busy" },
    });
  });

  it("marks session idle and emits completion when abort succeeds", async () => {
    await expect(abortSession("sess-9", "/workspace/project")).resolves.toBe(true);

    expect(sessionAbortMock).toHaveBeenCalledWith({ path: { id: "sess-9" } });
    expect(setSessionStatusMock).toHaveBeenCalledWith("sess-9", { type: "idle" });
    expect(emitSessionEventMock).toHaveBeenCalledWith(
      "sess-9",
      expect.objectContaining({ kind: "session.completed" }),
    );
  });
});
