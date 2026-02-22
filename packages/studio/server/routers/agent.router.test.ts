import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runTaskMock,
  listSessionsMock,
  deleteSessionMock,
  getAvailableModelsMock,
  validateModelSelectionMock,
} = vi.hoisted(() => ({
  runTaskMock: vi.fn(),
  listSessionsMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  getAvailableModelsMock: vi.fn(),
  validateModelSelectionMock: vi.fn(),
}));

vi.mock("../opencode/index.js", () => ({
  abortSession: vi.fn(),
  agentEventEmitter: {
    createSessionStream: vi.fn(),
  },
  deleteSession: deleteSessionMock,
  getAvailableModels: getAvailableModelsMock,
  getSessionContent: vi.fn(),
  getSessionsStatus: vi.fn(),
  listProjects: vi.fn(),
  listSessions: listSessionsMock,
  revertToUserMessage: vi.fn(),
  runTask: runTaskMock,
  unrevertSession: vi.fn(),
}));

vi.mock("../opencode/modelConfig.js", () => ({
  validateModelSelection: validateModelSelectionMock,
}));

import { agentRouter } from "./agent.js";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => "/tmp/workspace"),
    },
    ...overrides,
  };
}

describe("agent router", () => {
  beforeEach(() => {
    runTaskMock.mockReset();
    listSessionsMock.mockReset();
    deleteSessionMock.mockReset();
    getAvailableModelsMock.mockReset();
    validateModelSelectionMock.mockReset();

    runTaskMock.mockResolvedValue({ sessionId: "sess-1" });
    listSessionsMock.mockResolvedValue([]);
    deleteSessionMock.mockResolvedValue(undefined);
    getAvailableModelsMock.mockReturnValue([
      { provider: "openai", modelId: "gpt-4.1-mini" },
    ]);
    validateModelSelectionMock.mockImplementation((model) => model);
  });

  it("returns available models from the opencode layer", async () => {
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.getAvailableModels();

    expect(getAvailableModelsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ provider: "openai", modelId: "gpt-4.1-mini" }]);
  });

  it("rejects runTask when workspace is not initialized", async () => {
    const caller = agentRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => false),
          getProjectPath: vi.fn(),
        },
      }),
    );

    await expect(
      caller.runTask({
        projectSlug: "site-1",
        task: "change hero heading",
      }),
    ).rejects.toThrow("Workspace not initialized");
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it("uses validated model selection when provided", async () => {
    validateModelSelectionMock.mockReturnValueOnce({
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.runTask({
      projectSlug: "site-1",
      task: "polish copy",
      sessionId: "sess-existing",
      version: 3,
      model: { provider: "openai", modelId: "gpt-4.1-preview" },
    });

    expect(runTaskMock).toHaveBeenCalledWith(
      "polish copy",
      "/tmp/workspace",
      "sess-existing",
      { provider: "openai", modelId: "gpt-4.1-mini" },
    );
    expect(result).toEqual({ success: true, sessionId: "sess-1", version: 3 });
  });

  it("falls back to caller-provided model when validation returns null", async () => {
    validateModelSelectionMock.mockReturnValueOnce(null);
    const caller = agentRouter.createCaller(makeContext());

    await caller.runTask({
      projectSlug: "site-1",
      task: "polish copy",
      model: { provider: "anthropic", modelId: "claude-sonnet" },
    });

    expect(runTaskMock).toHaveBeenCalledWith(
      "polish copy",
      "/tmp/workspace",
      undefined,
      { provider: "anthropic", modelId: "claude-sonnet" },
    );
  });

  it("lists sessions for the active workspace directory", async () => {
    listSessionsMock.mockResolvedValueOnce([
      { id: "sess-1", title: "Session 1" },
      { id: "sess-2", title: "Session 2" },
    ]);
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.listSessions({
      projectSlug: "site-1",
      version: 1,
    });

    expect(listSessionsMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(result).toEqual([
      { id: "sess-1", title: "Session 1" },
      { id: "sess-2", title: "Session 2" },
    ]);
  });

  it("deletes a session via opencode and returns success", async () => {
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.deleteSession({
      sessionId: "sess-2",
      projectSlug: "site-1",
      version: 1,
    });

    expect(deleteSessionMock).toHaveBeenCalledWith("sess-2", "/tmp/workspace");
    expect(result).toEqual({ success: true });
  });
});
