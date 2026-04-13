import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context.js";

const {
  listSessionsMock,
  getSessionContentMock,
  getMessageDiffMock,
  getSessionsStatusMock,
  listPermissionsMock,
  listQuestionsMock,
  replyQuestionMock,
  rejectQuestionMock,
  respondPermissionMock,
} = vi.hoisted(() => ({
  listSessionsMock: vi.fn(),
  getSessionContentMock: vi.fn(),
  getMessageDiffMock: vi.fn(),
  getSessionsStatusMock: vi.fn(),
  listPermissionsMock: vi.fn(),
  listQuestionsMock: vi.fn(),
  replyQuestionMock: vi.fn(),
  rejectQuestionMock: vi.fn(),
  respondPermissionMock: vi.fn(),
}));

vi.mock("../opencode/index.js", () => ({
  getSessionContent: getSessionContentMock,
  getMessageDiff: getMessageDiffMock,
  getSessionsStatus: getSessionsStatusMock,
  listPermissions: listPermissionsMock,
  listQuestions: listQuestionsMock,
  listSessions: listSessionsMock,
  replyQuestion: replyQuestionMock,
  rejectQuestion: rejectQuestionMock,
  respondPermission: respondPermissionMock,
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

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => "/tmp/workspace"),
    } as unknown as Context["workspace"],
    ...overrides,
  } as Context;
}

describe("agentChat router", () => {
  beforeEach(() => {
    listSessionsMock.mockReset();
    getSessionContentMock.mockReset();
    getMessageDiffMock.mockReset();
    getSessionsStatusMock.mockReset();
    listPermissionsMock.mockReset();
    listQuestionsMock.mockReset();
    replyQuestionMock.mockReset();
    rejectQuestionMock.mockReset();
    respondPermissionMock.mockReset();
    listSessionsMock.mockResolvedValue([]);
    getSessionContentMock.mockResolvedValue([]);
    getMessageDiffMock.mockResolvedValue([]);
    getSessionsStatusMock.mockResolvedValue({});
    listPermissionsMock.mockResolvedValue([]);
    listQuestionsMock.mockResolvedValue([]);
    replyQuestionMock.mockResolvedValue(true);
    rejectQuestionMock.mockResolvedValue(true);
    respondPermissionMock.mockResolvedValue(true);
  });

  it("returns bootstrap data for the workspace", async () => {
    listSessionsMock.mockResolvedValueOnce([{ id: "sess-1", title: "A" }]);
    getSessionsStatusMock.mockResolvedValueOnce({
      "sess-1": { type: "busy" },
    });
    listQuestionsMock.mockResolvedValueOnce([{ id: "que-1", sessionID: "sess-1" }]);
    listPermissionsMock.mockResolvedValueOnce([{ id: "perm-1", sessionID: "sess-1", permission: "bash", patterns: ["vivd publish deploy --domain example.com"], always: ["vivd *"], metadata: {} }]);
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
    expect(listPermissionsMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(getSessionContentMock).toHaveBeenCalledWith("sess-1", "/tmp/workspace");
    expect(result).toEqual({
      sessions: [{ id: "sess-1", title: "A" }],
      statuses: { "sess-1": { type: "busy" } },
      questions: [{ id: "que-1", sessionID: "sess-1" }],
      permissions: [{ id: "perm-1", sessionID: "sess-1", permission: "bash", patterns: ["vivd publish deploy --domain example.com"], always: ["vivd *"], metadata: {} }],
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

  it("responds to a permission request in the workspace", async () => {
    const caller = agentChatRouter.createCaller(makeContext());

    const result = await caller.respondPermission({
      projectSlug: "site-1",
      version: 1,
      requestId: "perm-1",
      sessionId: "sess-1",
      response: "once",
    });

    expect(respondPermissionMock).toHaveBeenCalledWith(
      "perm-1",
      "sess-1",
      "once",
      "/tmp/workspace",
    );
    expect(result).toBe(true);
  });

  it("rejects calls when the workspace is not initialized", async () => {
    const caller = agentChatRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => false),
          getProjectPath: vi.fn(),
        } as unknown as Context["workspace"],
      }),
    );

    await expect(
      caller.bootstrap({
        projectSlug: "site-1",
      }),
    ).rejects.toThrow("Workspace not initialized");
  });
});
