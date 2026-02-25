import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getClientAndDirectoryMock,
  sessionCreateMock,
  sessionListMock,
  sessionStatusMock,
  sessionAbortMock,
  sessionPromptAsyncMock,
  getSessionStatusesMock,
  getSessionStatusSnapshotsMock,
  setSessionStatusMock,
  emitSessionEventMock,
  createAgentEventMock,
  getSystemPromptForSessionStartMock,
  finishSessionRunsMock,
} = vi.hoisted(() => ({
  getClientAndDirectoryMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  sessionListMock: vi.fn(),
  sessionStatusMock: vi.fn(),
  sessionAbortMock: vi.fn(),
  sessionPromptAsyncMock: vi.fn(),
  getSessionStatusesMock: vi.fn(),
  getSessionStatusSnapshotsMock: vi.fn(),
  setSessionStatusMock: vi.fn(),
  emitSessionEventMock: vi.fn(),
  createAgentEventMock: vi.fn((_sessionId, _type, payload) => payload),
  getSystemPromptForSessionStartMock: vi.fn(),
  finishSessionRunsMock: vi.fn(),
}));

vi.mock("./serverManager.js", () => ({
  serverManager: {
    getClientAndDirectory: getClientAndDirectoryMock,
  },
}));

vi.mock("./eventEmitter.js", () => ({
  agentEventEmitter: {
    getSessionStatuses: getSessionStatusesMock,
    getSessionStatusSnapshots: getSessionStatusSnapshotsMock,
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

vi.mock("../services/agent/AgentInstructionsService.js", () => ({
  agentInstructionsService: {
    getSystemPromptForSessionStart: getSystemPromptForSessionStartMock,
  },
}));

vi.mock("../services/reporting/AgentLeaseReporter.js", () => ({
  agentLeaseReporter: {
    startRun: vi.fn(),
    finishRun: vi.fn(),
    finishSession: finishSessionRunsMock,
  },
}));

import { abortSession, getSessionsStatus, listSessions, runTask } from "./index.js";

describe("opencode index session behavior", () => {
  beforeEach(() => {
    getClientAndDirectoryMock.mockReset();
    sessionCreateMock.mockReset();
    sessionListMock.mockReset();
    sessionStatusMock.mockReset();
    sessionAbortMock.mockReset();
    sessionPromptAsyncMock.mockReset();
    getSessionStatusesMock.mockReset();
    getSessionStatusSnapshotsMock.mockReset();
    setSessionStatusMock.mockReset();
    emitSessionEventMock.mockReset();
    createAgentEventMock.mockClear();
    getSystemPromptForSessionStartMock.mockReset();
    finishSessionRunsMock.mockReset();

    sessionListMock.mockResolvedValue({ data: [], error: undefined });
    sessionStatusMock.mockResolvedValue({ data: {}, error: undefined });
    sessionAbortMock.mockResolvedValue({ data: {}, error: undefined });
    sessionCreateMock.mockResolvedValue({ data: { id: "sess-new" }, error: undefined });
    sessionPromptAsyncMock.mockResolvedValue({ data: {}, error: undefined });
    getSessionStatusesMock.mockReturnValue({});
    getSessionStatusSnapshotsMock.mockReturnValue({});
    getSystemPromptForSessionStartMock.mockResolvedValue("system prompt");

    getClientAndDirectoryMock.mockResolvedValue({
      directory: "/workspace/project/",
      client: {
        session: {
          create: sessionCreateMock,
          list: sessionListMock,
          status: sessionStatusMock,
          abort: sessionAbortMock,
          promptAsync: sessionPromptAsyncMock,
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

  it("prefers backend statuses while allowing retry override when backend reports idle", async () => {
    sessionListMock.mockResolvedValueOnce({
      data: [
        { id: "sess-1", directory: "/workspace/project/" },
        { id: "sess-2", directory: "/workspace/project/" },
        { id: "sess-3", directory: "/workspace/project/" },
      ],
      error: undefined,
    });
    sessionStatusMock.mockResolvedValueOnce({
      data: {
        "sess-1": { type: "busy" },
        "sess-2": { type: "idle" },
        "sess-3": { type: "idle" },
        "sess-ghost": { type: "busy" },
      },
      error: undefined,
    });
    getSessionStatusesMock.mockReturnValueOnce({
      "sess-2": { type: "busy" },
      "sess-3": { type: "retry", message: "retrying", attempt: 2 },
      "sess-ghost": { type: "idle" },
    });

    const result = await getSessionsStatus("/workspace/project");

    expect(result).toEqual({
      "sess-1": { type: "busy" },
      "sess-2": { type: "idle" },
      "sess-3": { type: "retry", message: "retrying", attempt: 2 },
    });
  });

  it("defaults missing statuses to idle instead of stale emitter busy", async () => {
    sessionListMock.mockResolvedValueOnce({
      data: [
        { id: "sess-1", directory: "/workspace/project/" },
        { id: "sess-2", directory: "/workspace/project/" },
      ],
      error: undefined,
    });
    sessionStatusMock.mockResolvedValueOnce({
      data: [{ type: "busy" }],
      error: undefined,
    });
    getSessionStatusesMock.mockReturnValueOnce({
      "sess-1": { type: "busy" },
      "sess-2": { type: "busy" },
    });

    const result = await getSessionsStatus("/workspace/project");

    expect(result).toEqual({
      "sess-1": { type: "idle" },
      "sess-2": { type: "idle" },
    });
  });

  it("maps unkeyed backend status arrays by session index", async () => {
    sessionListMock.mockResolvedValueOnce({
      data: [
        { id: "sess-1", directory: "/workspace/project/" },
        { id: "sess-2", directory: "/workspace/project/" },
      ],
      error: undefined,
    });
    sessionStatusMock.mockResolvedValueOnce({
      data: [{ type: "idle" }, { type: "busy" }],
      error: undefined,
    });
    getSessionStatusesMock.mockReturnValueOnce({
      "sess-1": { type: "busy" },
      "sess-2": { type: "idle" },
    });

    const result = await getSessionsStatus("/workspace/project");

    expect(result).toEqual({
      "sess-1": { type: "idle" },
      "sess-2": { type: "busy" },
    });
  });

  it("keeps fresh emitter busy when backend status is temporarily ambiguous", async () => {
    const now = Date.now();

    sessionListMock.mockResolvedValueOnce({
      data: [{ id: "sess-1", directory: "/workspace/project/" }],
      error: undefined,
    });
    sessionStatusMock.mockResolvedValueOnce({
      data: [{ status: "unknown-shape" }],
      error: undefined,
    });
    getSessionStatusesMock.mockReturnValueOnce({
      "sess-1": { type: "busy" },
    });
    getSessionStatusSnapshotsMock.mockReturnValueOnce({
      "sess-1": {
        status: { type: "busy" },
        updatedAt: now,
      },
    });

    const result = await getSessionsStatus("/workspace/project");

    expect(result).toEqual({
      "sess-1": { type: "busy" },
    });
  });

  it("marks session idle and emits completion when abort succeeds", async () => {
    await expect(abortSession("sess-9", "/workspace/project")).resolves.toBe(true);

    expect(sessionAbortMock).toHaveBeenCalledWith({ path: { id: "sess-9" } });
    expect(finishSessionRunsMock).toHaveBeenCalledWith("sess-9");
    expect(setSessionStatusMock).toHaveBeenCalledWith("sess-9", { type: "idle" });
    expect(emitSessionEventMock).toHaveBeenCalledWith(
      "sess-9",
      expect.objectContaining({ kind: "session.completed" }),
    );
  });

  it("passes per-run tool enablement to promptAsync", async () => {
    await runTask(
      "run checklist",
      "/workspace/project",
      undefined,
      undefined,
      { tools: { vivd_publish_checklist: true } },
    );

    expect(sessionPromptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          system: "system prompt",
          tools: { vivd_publish_checklist: true },
        }),
      }),
    );
  });

  it("does not inject a new system prompt when continuing an existing session", async () => {
    await runTask("continue task", "/workspace/project", "sess-existing");

    expect(getSystemPromptForSessionStartMock).not.toHaveBeenCalled();
    expect(sessionPromptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.not.objectContaining({
          system: expect.any(String),
        }),
      }),
    );
  });

  it("emits session.error and rejects when promptAsync fails", async () => {
    sessionPromptAsyncMock.mockResolvedValueOnce({
      data: undefined,
      error: { message: "unsupported image format: .avif" },
    });

    await expect(
      runTask("process image", "/workspace/project", "sess-existing"),
    ).rejects.toThrow("unsupported image format: .avif");

    expect(emitSessionEventMock).toHaveBeenCalledWith(
      "sess-existing",
      expect.objectContaining({
        kind: "session.error",
        errorType: "task",
      }),
    );
    expect(setSessionStatusMock).toHaveBeenCalledWith("sess-existing", {
      type: "idle",
    });
  });
});
