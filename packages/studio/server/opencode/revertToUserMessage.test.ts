import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const {
  getClientAndDirectoryMock,
  getSessionStatusesMock,
  resolveOpencodeSnapshotGitStateMock,
  sessionGetMock,
  sessionMessagesMock,
  sessionRevertMock,
  snapshotGitDirHasObjectMock,
} = vi.hoisted(() => ({
  getClientAndDirectoryMock: vi.fn(),
  getSessionStatusesMock: vi.fn(),
  resolveOpencodeSnapshotGitStateMock: vi.fn(),
  sessionGetMock: vi.fn(),
  sessionMessagesMock: vi.fn(),
  sessionRevertMock: vi.fn(),
  snapshotGitDirHasObjectMock: vi.fn(),
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

vi.mock("./snapshotGitDirRepair.js", () => ({
  resolveOpencodeSnapshotGitState: resolveOpencodeSnapshotGitStateMock,
  snapshotGitDirHasObject: snapshotGitDirHasObjectMock,
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
    hasActiveSession: vi.fn(() => false),
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
    resolveOpencodeSnapshotGitStateMock.mockReset();
    sessionGetMock.mockReset();
    sessionMessagesMock.mockReset();
    sessionRevertMock.mockReset();
    snapshotGitDirHasObjectMock.mockReset();

    getSessionStatusesMock.mockReturnValue({});
    resolveOpencodeSnapshotGitStateMock.mockResolvedValue(null);
    sessionGetMock.mockResolvedValue({ data: {}, error: undefined });
    sessionMessagesMock.mockResolvedValue({ data: [], error: undefined });
    sessionRevertMock.mockResolvedValue({
      data: { revert: { messageID: "msg-user" } },
      error: undefined,
    });
    snapshotGitDirHasObjectMock.mockReturnValue(true);

    getClientAndDirectoryMock.mockResolvedValue({
      directory: "/workspace/project/",
      client: {
        session: {
          get: sessionGetMock,
          messages: sessionMessagesMock,
          revert: sessionRevertMock,
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

  it("treats the revert as successful when tracked files changed on disk", async () => {
    const tmpRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "vivd-opencode-revert-result-"),
    );
    const projectDir = path.join(tmpRoot, "project");
    const filePath = path.join(projectDir, "index.html");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(filePath, "AFTER\n", "utf-8");

    getClientAndDirectoryMock.mockResolvedValueOnce({
      directory: `${projectDir}/`,
      client: {
        session: {
          get: sessionGetMock,
          messages: sessionMessagesMock,
          revert: sessionRevertMock,
        },
      },
    });
    sessionGetMock.mockResolvedValueOnce({
      data: { revert: { messageID: "msg-user" } },
      error: undefined,
    });
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        {
          info: { id: "msg-user", role: "user" },
          parts: [{ id: "part-user", type: "text" }],
        },
        {
          info: { id: "msg-assistant", role: "assistant", parentID: "msg-user" },
          parts: [
            {
              id: "part-patch",
              type: "patch",
              hash: "snap-1",
              files: [filePath],
            },
          ],
        },
      ],
      error: undefined,
    });
    sessionRevertMock.mockImplementationOnce(async () => {
      await fs.writeFile(filePath, "BEFORE\n", "utf-8");
      return {
        data: { revert: { messageID: "msg-user" } },
        error: undefined,
      };
    });

    const result = await revertToUserMessage("sess-1", "msg-user", projectDir);

    expect(result).toEqual({
      reverted: true,
      messageId: "msg-user",
      trackedFiles: [filePath],
    });
  });

  it("refuses destructive revert attempts when older snapshot history is missing", async () => {
    resolveOpencodeSnapshotGitStateMock.mockResolvedValue({
      projectId: "project-1",
      worktree: "/workspace/project",
      snapshotRoot: "/data/opencode/snapshot",
      snapshotGitDir: "/data/opencode/snapshot/project-1",
    });
    snapshotGitDirHasObjectMock.mockReturnValue(false);
    sessionMessagesMock.mockResolvedValueOnce({
      data: [
        {
          info: { id: "msg-user", role: "user" },
          parts: [{ id: "part-user", type: "text" }],
        },
        {
          info: { id: "msg-assistant", role: "assistant", parentID: "msg-user" },
          parts: [
            {
              id: "part-patch",
              type: "patch",
              hash: "snap-missing",
              files: ["/workspace/project/src/pages/index.astro"],
            },
          ],
        },
      ],
      error: undefined,
    });

    const result = await revertToUserMessage(
      "sess-1",
      "msg-user",
      "/workspace/project",
    );

    expect(sessionRevertMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      reverted: false,
      reason: "missing_snapshot_history",
      messageId: "msg-user",
      trackedFiles: ["/workspace/project/src/pages/index.astro"],
    });
  });
});
