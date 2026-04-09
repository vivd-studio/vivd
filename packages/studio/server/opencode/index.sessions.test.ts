import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getClientAndDirectoryMock,
  sessionCreateMock,
  sessionListMock,
  sessionMessagesMock,
  sessionDiffMock,
  sessionStatusMock,
  sessionAbortMock,
  sessionSummarizeMock,
  sessionPromptAsyncMock,
  startEventsMock,
  stopEventsMock,
  useEventsCallbacksRef,
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
  sessionMessagesMock: vi.fn(),
  sessionDiffMock: vi.fn(),
  sessionStatusMock: vi.fn(),
  sessionAbortMock: vi.fn(),
  sessionSummarizeMock: vi.fn(),
  sessionPromptAsyncMock: vi.fn(),
  startEventsMock: vi.fn(),
  stopEventsMock: vi.fn(),
  useEventsCallbacksRef: { current: null as any },
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
  useEvents: vi.fn((_client, callbacks) => {
    useEventsCallbacksRef.current = callbacks;
    return {
      start: startEventsMock,
      stop: stopEventsMock,
    };
  }),
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

import {
  abortSession,
  createSession,
  getMessageDiff,
  getSessionsStatus,
  listSessions,
  runTask,
} from "./index.js";

describe("opencode index session behavior", () => {
  beforeEach(() => {
    getClientAndDirectoryMock.mockReset();
    sessionCreateMock.mockReset();
    sessionListMock.mockReset();
    sessionMessagesMock.mockReset();
    sessionDiffMock.mockReset();
    sessionStatusMock.mockReset();
    sessionAbortMock.mockReset();
    sessionSummarizeMock.mockReset();
    sessionPromptAsyncMock.mockReset();
    startEventsMock.mockReset();
    stopEventsMock.mockReset();
    useEventsCallbacksRef.current = null;
    getSessionStatusesMock.mockReset();
    getSessionStatusSnapshotsMock.mockReset();
    setSessionStatusMock.mockReset();
    emitSessionEventMock.mockReset();
    createAgentEventMock.mockClear();
    getSystemPromptForSessionStartMock.mockReset();
    finishSessionRunsMock.mockReset();

    sessionListMock.mockResolvedValue({ data: [], error: undefined });
    sessionMessagesMock.mockResolvedValue({ data: [], error: undefined });
    sessionDiffMock.mockResolvedValue({ data: [], error: undefined });
    sessionStatusMock.mockResolvedValue({ data: {}, error: undefined });
    sessionAbortMock.mockResolvedValue({ data: {}, error: undefined });
    sessionSummarizeMock.mockResolvedValue({ data: true, error: undefined });
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
          messages: sessionMessagesMock,
          diff: sessionDiffMock,
          status: sessionStatusMock,
          abort: sessionAbortMock,
          summarize: sessionSummarizeMock,
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

  it("loads per-message diffs with the current session and directory", async () => {
    sessionDiffMock.mockResolvedValueOnce({
      data: [
        {
          file: "src/index.html",
          before: "<h1>Before</h1>\n",
          after: "<h1>After</h1>\n",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
      ],
      error: undefined,
    });

    const result = await getMessageDiff(
      "sess-1",
      "msg-1",
      "/workspace/project",
    );

    expect(sessionDiffMock).toHaveBeenCalledWith({
      sessionID: "sess-1",
      directory: "/workspace/project/",
      messageID: "msg-1",
    });
    expect(result).toEqual([
      {
        file: "src/index.html",
        before: "<h1>Before</h1>\n",
        after: "<h1>After</h1>\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ]);
  });

  it("creates a session in the current opencode directory", async () => {
    const result = await createSession("/workspace/project");

    expect(sessionCreateMock).toHaveBeenCalledWith({
      directory: "/workspace/project/",
    });
    expect(result).toEqual({ id: "sess-new" });
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

    expect(sessionAbortMock).toHaveBeenCalledWith({
      sessionID: "sess-9",
      directory: "/workspace/project/",
    });
    expect(finishSessionRunsMock).toHaveBeenCalledWith("sess-9");
    expect(setSessionStatusMock).toHaveBeenCalledWith("sess-9", { type: "idle" });
    expect(emitSessionEventMock).toHaveBeenCalledWith(
      "sess-9",
      expect.objectContaining({ kind: "session.completed" }),
    );
  });

  it("passes per-run tool enablement to promptAsync", async () => {
    await runTask(
      "generate image",
      "/workspace/project",
      undefined,
      undefined,
      { tools: { vivd_image_ai: true } },
    );

    expect(sessionPromptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "sess-new",
        directory: "/workspace/project/",
        system: "system prompt",
        tools: { vivd_image_ai: true },
      }),
    );
  });

  it("injects the session-start system prompt for a pre-created empty session", async () => {
    await runTask("first message", "/workspace/project", "sess-existing");

    expect(getSystemPromptForSessionStartMock).toHaveBeenCalledTimes(1);
    expect(sessionPromptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "sess-existing",
        directory: "/workspace/project/",
        system: "system prompt",
      }),
    );
  });

  it("auto-compacts oversized sessions before sending the next prompt", async () => {
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        {
          info: {
            id: "a-last",
            role: "assistant",
            providerID: "google",
            modelID: "gemini-2.5-flash",
            tokens: {
              input: 180_000,
              output: 15_000,
              reasoning: 5_500,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [{ type: "text", text: "Large context" }],
        },
      ],
      error: undefined,
    });

    await runTask(
      "continue task",
      "/workspace/project",
      "sess-existing",
      { provider: "google", modelId: "gemini-2.5-flash" },
    );

    expect(sessionSummarizeMock).toHaveBeenCalledWith({
      sessionID: "sess-existing",
      directory: "/workspace/project/",
      providerID: "google",
      modelID: "gemini-2.5-flash",
      auto: true,
    });
    expect(sessionSummarizeMock.mock.invocationCallOrder[0]).toBeLessThan(
      sessionPromptAsyncMock.mock.invocationCallOrder[0],
    );
  });

  it("does not inject a new system prompt when continuing an existing session", async () => {
    const existingMessages = {
      data: [
        {
          info: {
            id: "msg-existing",
            role: "user",
          },
          parts: [{ type: "text", text: "Earlier message" }],
        },
      ],
      error: undefined,
    };
    sessionMessagesMock
      .mockResolvedValueOnce(existingMessages)
      .mockResolvedValueOnce(existingMessages);

    await runTask("continue task", "/workspace/project", "sess-existing");

    expect(getSystemPromptForSessionStartMock).not.toHaveBeenCalled();
    expect(sessionPromptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "sess-existing",
        directory: "/workspace/project/",
      }),
    );
    expect(sessionPromptAsyncMock.mock.calls[0]?.[0]).not.toHaveProperty("system");
  });

  it("can skip the session-start system prompt for new sessions", async () => {
    await runTask("start scratch build", "/workspace/project", undefined, undefined, {
      skipSessionStartSystemPrompt: true,
    });

    expect(getSystemPromptForSessionStartMock).not.toHaveBeenCalled();
    expect(sessionPromptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "sess-new",
        directory: "/workspace/project/",
      }),
    );
    expect(sessionPromptAsyncMock.mock.calls[0]?.[0]).not.toHaveProperty("system");
  });

  it("auto-compacts oversized sessions after the run finishes", async () => {
    const oversizedMessages = {
      data: [
        {
          info: {
            id: "a-finished",
            role: "assistant",
            finish: "stop",
            time: {
              completed: Date.now(),
            },
            providerID: "openrouter",
            modelID: "google/gemini-2.5-pro",
            tokens: {
              input: 195_000,
              output: 4_500,
              reasoning: 1_500,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [{ type: "text", text: "Done" }],
        },
      ],
      error: undefined,
    };
    sessionMessagesMock
      .mockResolvedValueOnce({
        data: [],
        error: undefined,
      })
      .mockResolvedValueOnce(oversizedMessages)
      .mockResolvedValueOnce(oversizedMessages)
      .mockResolvedValueOnce(oversizedMessages);

    await runTask("continue task", "/workspace/project", "sess-existing");

    expect(useEventsCallbacksRef.current?.onIdle).toBeTypeOf("function");
    await useEventsCallbacksRef.current.onIdle();

    expect(sessionSummarizeMock).toHaveBeenCalledWith({
      sessionID: "sess-existing",
      directory: "/workspace/project/",
      providerID: "openrouter",
      modelID: "google/gemini-2.5-pro",
      auto: true,
    });
    expect(stopEventsMock).toHaveBeenCalledTimes(1);
    expect(emitSessionEventMock).toHaveBeenCalledWith(
      "sess-existing",
      expect.objectContaining({ kind: "session.completed" }),
    );
  });

  it("does not emit session.completed when idle arrives before the latest assistant is terminal", async () => {
    const unfinishedMessages = {
      data: [
        {
          info: {
            id: "a-unfinished",
            role: "assistant",
            providerID: "openrouter",
            modelID: "google/gemini-2.5-pro",
            tokens: {
              input: 150_000,
              output: 3_000,
              reasoning: 1_000,
              cache: { read: 0, write: 0 },
            },
          },
          parts: [{ type: "reasoning", text: "Still working" }],
        },
      ],
      error: undefined,
    };
    sessionMessagesMock
      .mockResolvedValueOnce({
        data: [],
        error: undefined,
      })
      .mockResolvedValueOnce(unfinishedMessages)
      .mockResolvedValueOnce(unfinishedMessages);

    await runTask("continue task", "/workspace/project", "sess-existing");

    expect(useEventsCallbacksRef.current?.onIdle).toBeTypeOf("function");
    await useEventsCallbacksRef.current.onIdle();

    expect(emitSessionEventMock).not.toHaveBeenCalledWith(
      "sess-existing",
      expect.objectContaining({ kind: "session.completed" }),
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
