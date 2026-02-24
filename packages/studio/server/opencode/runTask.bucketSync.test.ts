import { beforeEach, describe, expect, it, vi } from "vitest";

const {
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
} = vi.hoisted(() => ({
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

import { runTask } from "./index.js";

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runTask completion sync", () => {
  beforeEach(() => {
    onIdleHandler = undefined;
    setSessionStatusMock.mockReset();
    emitSessionEventMock.mockReset();
    createAgentEventMock.mockClear();
    getClientAndDirectoryMock.mockReset();
    startMock.mockReset();
    stopMock.mockReset();
    requestBucketSyncAfterAgentTaskMock.mockReset();
    usageReportMock.mockReset();
    updateSessionTitleMock.mockReset();
    getSystemPromptForSessionStartMock.mockReset();

    startMock.mockResolvedValue(undefined);
    stopMock.mockReturnValue(undefined);
    usageReportMock.mockResolvedValue(undefined);
    updateSessionTitleMock.mockResolvedValue(undefined);
    getSystemPromptForSessionStartMock.mockResolvedValue("system prompt");

    getClientAndDirectoryMock.mockResolvedValue({
      directory: "/workspace/project",
      client: {
        session: {
          create: vi.fn().mockResolvedValue({ data: { id: "session-1" } }),
          promptAsync: vi.fn().mockResolvedValue({ data: {} }),
          list: vi.fn().mockResolvedValue({
            data: [{ id: "session-1", title: "Session 1" }],
          }),
        },
      },
    });
  });

  it("requests exactly one bucket sync when idle events fire more than once", async () => {
    await runTask("update site", "/workspace/project");
    expect(typeof onIdleHandler).toBe("function");

    onIdleHandler?.();
    onIdleHandler?.();
    await flushPromises();

    expect(requestBucketSyncAfterAgentTaskMock).toHaveBeenCalledTimes(1);
    expect(requestBucketSyncAfterAgentTaskMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      projectDir: "/workspace/project",
    });
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
