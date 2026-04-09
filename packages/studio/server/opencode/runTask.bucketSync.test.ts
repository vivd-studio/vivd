import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  sessionMessagesMock,
  setSessionStatusMock,
  emitSessionEventMock,
  createAgentEventMock,
  getClientAndDirectoryMock,
  startMock,
  stopMock,
  requestBucketSyncAfterAgentTaskMock,
  usageReportMock,
  updateSessionTitleMock,
  getSystemPromptForSessionStartMock,
  startRunMock,
  finishRunMock,
} = vi.hoisted(() => ({
  sessionMessagesMock: vi.fn(),
  setSessionStatusMock: vi.fn(),
  emitSessionEventMock: vi.fn(),
  createAgentEventMock: vi.fn((_sessionId, _type, payload) => payload),
  getClientAndDirectoryMock: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
  requestBucketSyncAfterAgentTaskMock: vi.fn(),
  usageReportMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  getSystemPromptForSessionStartMock: vi.fn(),
  startRunMock: vi.fn(),
  finishRunMock: vi.fn(),
}));

let onIdleHandler: (() => void) | undefined;

vi.mock("./eventEmitter.js", () => ({
  agentEventEmitter: {
    setSessionStatus: setSessionStatusMock,
    emitSessionEvent: emitSessionEventMock,
    getSessionStatuses: vi.fn(() => ({})),
  },
  createAgentEvent: createAgentEventMock,
}));

vi.mock("./serverManager.js", () => ({
  serverManager: {
    getClientAndDirectory: getClientAndDirectoryMock,
  },
}));

vi.mock("./useEvents.js", () => ({
  useEvents: vi.fn((_client: unknown, callbacks: { onIdle?: () => void }) => {
    onIdleHandler = callbacks.onIdle;
    return {
      start: startMock,
      stop: stopMock,
    };
  }),
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSyncAfterAgentTask: requestBucketSyncAfterAgentTaskMock,
}));

vi.mock("../services/reporting/UsageReporter.js", () => ({
  usageReporter: {
    report: usageReportMock,
    updateSessionTitle: updateSessionTitleMock,
  },
}));

vi.mock("./modelConfig.js", () => ({
  getDefaultModel: vi.fn(() => ({
    provider: "test-provider",
    modelId: "test-model",
  })),
  getAvailableModels: vi.fn(() => []),
}));

vi.mock("../services/agent/AgentInstructionsService.js", () => ({
  agentInstructionsService: {
    getSystemPromptForSessionStart: getSystemPromptForSessionStartMock,
  },
}));

vi.mock("../services/reporting/AgentLeaseReporter.js", () => ({
  agentLeaseReporter: {
    startRun: startRunMock,
    finishRun: finishRunMock,
    finishSession: vi.fn(),
  },
}));

import { runTask } from "./index.js";

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const originalProjectSlug = process.env.VIVD_PROJECT_SLUG;
const originalProjectVersion = process.env.VIVD_PROJECT_VERSION;

describe("runTask completion sync", () => {
  beforeEach(() => {
    onIdleHandler = undefined;
    setSessionStatusMock.mockReset();
    emitSessionEventMock.mockReset();
    createAgentEventMock.mockClear();
    getClientAndDirectoryMock.mockReset();
    sessionMessagesMock.mockReset();
    startMock.mockReset();
    stopMock.mockReset();
    requestBucketSyncAfterAgentTaskMock.mockReset();
    usageReportMock.mockReset();
    updateSessionTitleMock.mockReset();
    getSystemPromptForSessionStartMock.mockReset();
    startRunMock.mockReset();
    finishRunMock.mockReset();

    startMock.mockResolvedValue(undefined);
    stopMock.mockReturnValue(undefined);
    requestBucketSyncAfterAgentTaskMock.mockReturnValue(true);
    usageReportMock.mockResolvedValue(undefined);
    updateSessionTitleMock.mockResolvedValue(undefined);
    getSystemPromptForSessionStartMock.mockResolvedValue("system prompt");
    process.env.VIVD_PROJECT_SLUG = "site-1";
    process.env.VIVD_PROJECT_VERSION = "1";

    getClientAndDirectoryMock.mockResolvedValue({
      directory: "/workspace/project",
      client: {
        session: {
          create: vi.fn().mockResolvedValue({ data: { id: "session-1" } }),
          promptAsync: vi.fn().mockResolvedValue({ data: {} }),
          list: vi.fn().mockResolvedValue({
            data: [{ id: "session-1", title: "Session 1" }],
          }),
          messages: sessionMessagesMock,
        },
      },
    });
  });

  it("requests exactly one bucket sync when non-terminal idle events fire more than once", async () => {
    const unfinishedMessages = {
      data: [
        {
          info: {
            id: "a-unfinished",
            role: "assistant",
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
      .mockResolvedValue(unfinishedMessages);

    await runTask("update site", "/workspace/project");
    expect(typeof onIdleHandler).toBe("function");

    await onIdleHandler?.();
    await onIdleHandler?.();
    await flushPromises();

    expect(requestBucketSyncAfterAgentTaskMock).toHaveBeenCalledTimes(1);
    expect(requestBucketSyncAfterAgentTaskMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      projectDir: "/workspace/project",
    });
    expect(startRunMock).toHaveBeenCalledTimes(1);
    expect(startRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        projectSlug: "site-1",
        version: 1,
      }),
    );
    expect(finishRunMock).not.toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  process.env.VIVD_PROJECT_SLUG = originalProjectSlug;
  process.env.VIVD_PROJECT_VERSION = originalProjectVersion;
});
