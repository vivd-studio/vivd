import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getClientAndDirectoryMock,
  getSessionStatusesMock,
  sessionGetMock,
  sessionMessagesMock,
  sessionRevertMock,
  sessionDiffMock,
} = vi.hoisted(() => ({
  getClientAndDirectoryMock: vi.fn(),
  getSessionStatusesMock: vi.fn(),
  sessionGetMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  sessionRevertMock: vi.fn(),
  sessionDiffMock: vi.fn(),
}));

vi.mock("./serverManager.js", () => ({
  serverManager: {
    getClientAndDirectory: getClientAndDirectoryMock,
  },
}));

vi.mock("./eventEmitter.js", () => ({
  agentEventEmitter: {
    getSessionStatuses: getSessionStatusesMock,
  },
  createAgentEvent: vi.fn(),
}));

vi.mock("./useEvents.js", () => ({
  useEvents: vi.fn(),
}));

vi.mock("../services/reporting/UsageReporter.js", () => ({
  usageReporter: {
    report: vi.fn(),
    updateSessionTitle: vi.fn(),
  },
}));

vi.mock("../services/reporting/AgentLeaseReporter.js", () => ({
  agentLeaseReporter: {
    startRun: vi.fn(),
    finishRun: vi.fn(),
    finishSession: vi.fn(),
  },
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSyncAfterAgentTask: vi.fn(),
}));

vi.mock("../services/agent/AgentInstructionsService.js", () => ({
  agentInstructionsService: {
    getSystemPromptForSessionStart: vi.fn(),
  },
}));

vi.mock("./modelConfig.js", () => ({
  getDefaultModel: vi.fn(() => ({ provider: "test-provider", modelId: "test-model" })),
  getAvailableModels: vi.fn(() => []),
  getAvailableModelsWithMetadata: vi.fn(() => []),
}));

import { revertToUserMessage } from "./index.js";

describe("revertToUserMessage", () => {
  beforeEach(() => {
    getClientAndDirectoryMock.mockReset();
    getSessionStatusesMock.mockReset();
    sessionGetMock.mockReset();
    sessionMessagesMock.mockReset();
    sessionRevertMock.mockReset();
    sessionDiffMock.mockReset();

    getSessionStatusesMock.mockReturnValue({});
    sessionGetMock.mockResolvedValue({ data: {}, error: undefined });
    sessionMessagesMock.mockResolvedValue({ data: [], error: undefined });
    sessionRevertMock.mockResolvedValue({
      data: { revert: { messageID: "msg-user" } },
      error: undefined,
    });
    sessionDiffMock.mockResolvedValue({ data: [], error: undefined });

    getClientAndDirectoryMock.mockResolvedValue({
      directory: "/workspace/project/",
      client: {
        session: {
          get: sessionGetMock,
          messages: sessionMessagesMock,
          revert: sessionRevertMock,
          diff: sessionDiffMock,
        },
      },
    });
  });

  it("falls back to tracked patch parts when OpenCode omits revert diff metadata", async () => {
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        {
          info: { id: "msg-user", role: "user" },
          parts: [{ id: "part-user", type: "text" }],
        },
        {
          info: { id: "msg-assistant", role: "assistant", parentID: "msg-user" },
          parts: [
            { id: "part-text", type: "text", text: "Done." },
            {
              id: "part-patch",
              type: "patch",
              hash: "snap-1",
              files: ["/workspace/project/index.html"],
            },
          ],
        },
      ],
      error: undefined,
    });
    sessionRevertMock.mockResolvedValueOnce({
      data: { revert: { messageID: "msg-user" } },
      error: undefined,
    });

    const result = await revertToUserMessage(
      "sess-1",
      "msg-user",
      "/workspace/project",
    );

    expect(sessionMessagesMock).toHaveBeenCalledWith({
      sessionID: "sess-1",
      directory: "/workspace/project/",
    });
    expect(sessionRevertMock).toHaveBeenCalledWith({
      sessionID: "sess-1",
      directory: "/workspace/project/",
      messageID: "msg-user",
    });
    expect(result).toEqual({
      reverted: true,
      messageId: "msg-user",
      trackedFiles: ["/workspace/project/index.html"],
    });
  });

  it("derives tracked files from the actual revert diff when OpenCode reports a revert", async () => {
    sessionMessagesMock.mockResolvedValueOnce({
      data: [],
      error: undefined,
    });
    sessionRevertMock.mockResolvedValueOnce({
      data: {
        revert: {
          messageID: "msg-user",
          diff: [
            "diff --git a/index.html b/index.html",
            "--- a/index.html",
            "+++ b/index.html",
            "@@ -1 +1 @@",
            "-BEFORE",
            "+AFTER",
          ].join("\n"),
        },
      },
      error: undefined,
    });

    const result = await revertToUserMessage(
      "sess-1",
      "msg-user",
      "/workspace/project",
    );

    expect(result).toEqual({
      reverted: true,
      messageId: "msg-user",
      trackedFiles: ["index.html"],
    });
  });

  it("returns reverted=false when OpenCode leaves the revert state unchanged", async () => {
    sessionGetMock.mockResolvedValueOnce({
      data: { revert: { messageID: "msg-user" } },
      error: undefined,
    });
    sessionRevertMock.mockResolvedValueOnce({
      data: { revert: { messageID: "msg-user" } },
      error: undefined,
    });

    const result = await revertToUserMessage(
      "sess-1",
      "msg-user",
      "/workspace/project",
    );

    expect(result).toEqual({
      reverted: false,
      messageId: "msg-user",
      trackedFiles: [],
    });
  });
});
