import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context.js";

const {
  createSessionMock,
  runTaskMock,
  listSessionsMock,
  deleteSessionMock,
  getAvailableModelsWithMetadataMock,
  getSessionContentMock,
  getSessionsStatusMock,
  validateModelSelectionMock,
  isConnectedModeMock,
  getBackendUrlMock,
  getSessionTokenMock,
  getStudioIdMock,
  getConnectedOrganizationIdMock,
  startInitialGenerationServiceMock,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  runTaskMock: vi.fn(),
  listSessionsMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  getAvailableModelsWithMetadataMock: vi.fn(),
  getSessionContentMock: vi.fn(),
  getSessionsStatusMock: vi.fn(),
  validateModelSelectionMock: vi.fn(),
  isConnectedModeMock: vi.fn(),
  getBackendUrlMock: vi.fn(),
  getSessionTokenMock: vi.fn(),
  getStudioIdMock: vi.fn(),
  getConnectedOrganizationIdMock: vi.fn(),
  startInitialGenerationServiceMock: vi.fn(),
}));

vi.mock("../opencode/index.js", () => ({
  abortSession: vi.fn(),
  agentEventEmitter: {
    createSessionStream: vi.fn(),
  },
  createSession: createSessionMock,
  deleteSession: deleteSessionMock,
  getAvailableModelsWithMetadata: getAvailableModelsWithMetadataMock,
  getSessionContent: getSessionContentMock,
  getSessionsStatus: getSessionsStatusMock,
  listProjects: vi.fn(),
  listSessions: listSessionsMock,
  revertToUserMessage: vi.fn(),
  runTask: runTaskMock,
  unrevertSession: vi.fn(),
}));

vi.mock("../opencode/modelConfig.js", () => ({
  validateModelSelection: validateModelSelectionMock,
}));

vi.mock(
  "../services/initialGeneration/InitialGenerationService.js",
  () => ({
    initialGenerationService: {
      startInitialGeneration: startInitialGenerationServiceMock,
    },
  }),
);

vi.mock("@vivd/shared", () => ({
  getBackendUrl: getBackendUrlMock,
  getConnectedOrganizationId: getConnectedOrganizationIdMock,
  getSessionToken: getSessionTokenMock,
  getStudioId: getStudioIdMock,
  isConnectedMode: isConnectedModeMock,
}));

import { agentRouter } from "./agent.js";

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => "/tmp/workspace"),
    } as unknown as Context["workspace"],
    ...overrides,
  } as Context;
}

describe("agent router", () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    runTaskMock.mockReset();
    listSessionsMock.mockReset();
    deleteSessionMock.mockReset();
    getAvailableModelsWithMetadataMock.mockReset();
    getSessionContentMock.mockReset();
    getSessionsStatusMock.mockReset();
    validateModelSelectionMock.mockReset();
    isConnectedModeMock.mockReset();
    getBackendUrlMock.mockReset();
    getSessionTokenMock.mockReset();
    getStudioIdMock.mockReset();
    getConnectedOrganizationIdMock.mockReset();
    startInitialGenerationServiceMock.mockReset();
    vi.unstubAllGlobals();

    createSessionMock.mockResolvedValue({
      id: "sess-created",
      title: "New Session",
    });
    runTaskMock.mockResolvedValue({ sessionId: "sess-1" });
    listSessionsMock.mockResolvedValue([]);
    deleteSessionMock.mockResolvedValue(undefined);
    getAvailableModelsWithMetadataMock.mockResolvedValue([
      { provider: "openai", modelId: "gpt-4.1-mini" },
    ]);
    getSessionContentMock.mockResolvedValue([]);
    getSessionsStatusMock.mockResolvedValue({});
    validateModelSelectionMock.mockImplementation((model) => model);
    isConnectedModeMock.mockReturnValue(false);
    getBackendUrlMock.mockReturnValue("");
    getSessionTokenMock.mockReturnValue("");
    getStudioIdMock.mockReturnValue("");
    getConnectedOrganizationIdMock.mockReturnValue(undefined);
    startInitialGenerationServiceMock.mockResolvedValue({
      sessionId: "sess-initial",
      reused: false,
      status: "generating_initial_site",
    });
  });

  it("returns available models from the opencode layer", async () => {
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.getAvailableModels();

    expect(getAvailableModelsWithMetadataMock).toHaveBeenCalledWith(
      "/tmp/workspace",
    );
    expect(result).toEqual([{ provider: "openai", modelId: "gpt-4.1-mini" }]);
  });

  it("returns runtime config for the studio client", async () => {
    process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS = "310000";
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.getRuntimeConfig();

    expect(result).toEqual({
      softContextLimitTokens: 310_000,
    });

    delete process.env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
  });

  it("creates a session for the active workspace directory", async () => {
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.createSession({
      projectSlug: "site-1",
      version: 2,
    });

    expect(createSessionMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(result).toEqual({
      success: true,
      sessionId: "sess-created",
      session: {
        id: "sess-created",
        title: "New Session",
      },
      version: 2,
    });
  });

  it("rejects runTask when workspace is not initialized", async () => {
    const caller = agentRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => false),
          getProjectPath: vi.fn(),
        } as unknown as Context["workspace"],
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

  it("starts initial generation with the validated caller-provided model", async () => {
    validateModelSelectionMock.mockReturnValueOnce({
      provider: "openai",
      modelId: "gpt-5.4",
    });
    const caller = agentRouter.createCaller(makeContext());

    const result = await caller.startInitialGeneration({
      projectSlug: "site-1",
      version: 3,
      model: { provider: "openai", modelId: "gpt-5.4-preview" },
    });

    expect(startInitialGenerationServiceMock).toHaveBeenCalledWith({
      projectSlug: "site-1",
      version: 3,
      workspaceDir: "/tmp/workspace",
      model: { provider: "openai", modelId: "gpt-5.4" },
    });
    expect(result).toEqual({
      sessionId: "sess-initial",
      reused: false,
      status: "generating_initial_site",
    });
  });

  it("starts initial generation without an explicit model override by default", async () => {
    const caller = agentRouter.createCaller(makeContext());

    await caller.startInitialGeneration({
      projectSlug: "site-1",
      version: 3,
    });

    expect(startInitialGenerationServiceMock).toHaveBeenCalledWith({
      projectSlug: "site-1",
      version: 3,
      workspaceDir: "/tmp/workspace",
      model: undefined,
    });
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

  it("enables checklist tool only for connected checklist runs", async () => {
    isConnectedModeMock.mockReturnValue(true);
    getBackendUrlMock.mockReturnValue("http://backend.test");
    getSessionTokenMock.mockReturnValue("session-token");
    getStudioIdMock.mockReturnValue("studio-1");
    getConnectedOrganizationIdMock.mockReturnValue("org-1");
    runTaskMock.mockResolvedValueOnce({ sessionId: "sess-checklist" });
    getSessionContentMock.mockResolvedValueOnce([
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            text: `\`\`\`json
{"items":[{"id":"dns_record","label":"DNS record","status":"pass","note":"configured"}]}
\`\`\``,
          },
        ],
      },
    ]);
    getSessionsStatusMock.mockResolvedValueOnce({
      "sess-checklist": { type: "idle" },
    });

    const fetchMock = vi
      .fn()
      // Seed pending checklist in backend.
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
        json: async () => ({}),
      })
      // Read backend checklist (returns stale/missing to force JSON fallback).
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
        json: async () => ({ result: { data: { json: { checklist: null } } } }),
      })
      // Persist fallback checklist payload.
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const caller = agentRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => true),
          getProjectPath: vi.fn(() => "/tmp"),
          commit: vi.fn(async () => "commit-123"),
          hasChanges: vi.fn(async () => false),
        } as unknown as Context["workspace"],
      }),
    );

    const result = await caller.runPrePublishChecklist({
      projectSlug: "site-1",
      version: 2,
    });

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.any(String),
      "/tmp",
      undefined,
      undefined,
      { tools: { vivd_publish_checklist: true } },
    );
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("sess-checklist");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
