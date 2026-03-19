import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listSessionsMock,
  getSessionContentMock,
  getMessageDiffMock,
  getSessionsStatusMock,
  listQuestionsMock,
  replyQuestionMock,
  rejectQuestionMock,
} = vi.hoisted(() => ({
  listSessionsMock: vi.fn(),
  getSessionContentMock: vi.fn(),
  getMessageDiffMock: vi.fn(),
  getSessionsStatusMock: vi.fn(),
  listQuestionsMock: vi.fn(),
  replyQuestionMock: vi.fn(),
  rejectQuestionMock: vi.fn(),
}));

vi.mock("../opencode/index.js", () => ({
  getSessionContent: getSessionContentMock,
  getMessageDiff: getMessageDiffMock,
  getSessionsStatus: getSessionsStatusMock,
  listQuestions: listQuestionsMock,
  listSessions: listSessionsMock,
  replyQuestion: replyQuestionMock,
  rejectQuestion: rejectQuestionMock,
}));

vi.mock("../opencode/events/canonicalEventBridge.js", () => ({
  canonicalEventBridge: {
    createWorkspaceStream: vi.fn(),
  },
}));

vi.mock("../opencode/events/workspaceEventPump.js", () => ({
  workspaceEventPump: {
    acquire: vi.fn(async () => () => {}),
  },
}));

import { agentChatRouter } from "./agentChat.js";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => "/tmp/workspace"),
    },
    ...overrides,
  };
}

describe("agentChat router", () => {
  beforeEach(() => {
    listSessionsMock.mockReset();
    getSessionContentMock.mockReset();
    getMessageDiffMock.mockReset();
    getSessionsStatusMock.mockReset();
    listQuestionsMock.mockReset();
    replyQuestionMock.mockReset();
    rejectQuestionMock.mockReset();
    listSessionsMock.mockResolvedValue([]);
    getSessionContentMock.mockResolvedValue([]);
    getMessageDiffMock.mockResolvedValue([]);
    getSessionsStatusMock.mockResolvedValue({});
    listQuestionsMock.mockResolvedValue([]);
    replyQuestionMock.mockResolvedValue(true);
    rejectQuestionMock.mockResolvedValue(true);
  });

  it("returns bootstrap data for the workspace", async () => {
    listSessionsMock.mockResolvedValueOnce([{ id: "sess-1", title: "A" }]);
    getSessionsStatusMock.mockResolvedValueOnce({
      "sess-1": { type: "busy" },
    });
    listQuestionsMock.mockResolvedValueOnce([{ id: "que-1", sessionID: "sess-1" }]);
    getSessionContentMock.mockResolvedValueOnce([{ id: "msg-1" }]);

    const caller = agentChatRouter.createCaller(makeContext());
    const result = await caller.bootstrap({
      projectSlug: "site-1",
      version: 1,
      sessionId: "sess-1",
    });

    expect(listSessionsMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(getSessionsStatusMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(listQuestionsMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(getSessionContentMock).toHaveBeenCalledWith("sess-1", "/tmp/workspace");
    expect(result).toEqual({
      sessions: [{ id: "sess-1", title: "A" }],
      statuses: { "sess-1": { type: "busy" } },
      questions: [{ id: "que-1", sessionID: "sess-1" }],
      messages: [{ id: "msg-1" }],
    });
  });

  it("does not fetch messages during bootstrap when no session is selected", async () => {
    const caller = agentChatRouter.createCaller(makeContext());
    const result = await caller.bootstrap({
      projectSlug: "site-1",
      version: 1,
    });

    expect(getSessionContentMock).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
  });

  it("replies to a question request in the workspace", async () => {
    const caller = agentChatRouter.createCaller(makeContext());

    const result = await caller.replyQuestion({
      projectSlug: "site-1",
      version: 1,
      requestId: "que-1",
      answers: [["Option A"]],
    });

    expect(replyQuestionMock).toHaveBeenCalledWith(
      "que-1",
      [["Option A"]],
      "/tmp/workspace",
    );
    expect(result).toBe(true);
  });

  it("rejects a question request in the workspace", async () => {
    const caller = agentChatRouter.createCaller(makeContext());

    const result = await caller.rejectQuestion({
      projectSlug: "site-1",
      version: 1,
      requestId: "que-1",
    });

    expect(rejectQuestionMock).toHaveBeenCalledWith("que-1", "/tmp/workspace");
    expect(result).toBe(true);
  });

  it("loads per-message diffs in the workspace", async () => {
    getMessageDiffMock.mockResolvedValueOnce([
      {
        file: "src/index.html",
        before: "<h1>Before</h1>\n",
        after: "<h1>After</h1>\n",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ]);

    const caller = agentChatRouter.createCaller(makeContext());
    const result = await caller.messageDiff({
      projectSlug: "site-1",
      version: 1,
      sessionId: "sess-1",
      messageId: "msg-1",
    });

    expect(getMessageDiffMock).toHaveBeenCalledWith(
      "sess-1",
      "msg-1",
      "/tmp/workspace",
    );
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

  it("rejects calls when the workspace is not initialized", async () => {
    const caller = agentChatRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => false),
          getProjectPath: vi.fn(),
        },
      }),
    );

    await expect(
      caller.bootstrap({
        projectSlug: "site-1",
      }),
    ).rejects.toThrow("Workspace not initialized");
  });
});
