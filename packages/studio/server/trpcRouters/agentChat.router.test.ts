import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listSessionsMock,
  getSessionContentMock,
  getSessionsStatusMock,
} = vi.hoisted(() => ({
  listSessionsMock: vi.fn(),
  getSessionContentMock: vi.fn(),
  getSessionsStatusMock: vi.fn(),
}));

vi.mock("../opencode/index.js", () => ({
  getSessionContent: getSessionContentMock,
  getSessionsStatus: getSessionsStatusMock,
  listSessions: listSessionsMock,
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
    getSessionsStatusMock.mockReset();
    listSessionsMock.mockResolvedValue([]);
    getSessionContentMock.mockResolvedValue([]);
    getSessionsStatusMock.mockResolvedValue({});
  });

  it("returns bootstrap data for the workspace", async () => {
    listSessionsMock.mockResolvedValueOnce([{ id: "sess-1", title: "A" }]);
    getSessionsStatusMock.mockResolvedValueOnce({
      "sess-1": { type: "busy" },
    });
    getSessionContentMock.mockResolvedValueOnce([{ id: "msg-1" }]);

    const caller = agentChatRouter.createCaller(makeContext());
    const result = await caller.bootstrap({
      projectSlug: "site-1",
      version: 1,
      sessionId: "sess-1",
    });

    expect(listSessionsMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(getSessionsStatusMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(getSessionContentMock).toHaveBeenCalledWith("sess-1", "/tmp/workspace");
    expect(result).toEqual({
      sessions: [{ id: "sess-1", title: "A" }],
      statuses: { "sess-1": { type: "busy" } },
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
