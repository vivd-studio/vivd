import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  runTaskMock,
  deleteSessionMock,
  getSessionContentMock,
  listSessionsMock,
  listQuestionsMock,
  getSessionsStatusMock,
  subscribeToSessionMock,
  isSessionCompletedMock,
  syncSourceToBucketMock,
  buildAndUploadPreviewMock,
  requestBucketSyncMock,
  saveInitialGenerationSnapshotMock,
  thumbnailRequestMock,
  detectProjectTypeMock,
  isConnectedModeMock,
  getBackendUrlMock,
  getConnectedOrganizationIdMock,
  getSessionTokenMock,
  getStudioIdMock,
} = vi.hoisted(() => ({
  runTaskMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  getSessionContentMock: vi.fn(),
  listSessionsMock: vi.fn(),
  listQuestionsMock: vi.fn(),
  getSessionsStatusMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
  isSessionCompletedMock: vi.fn(),
  syncSourceToBucketMock: vi.fn(),
  buildAndUploadPreviewMock: vi.fn(),
  requestBucketSyncMock: vi.fn(),
  saveInitialGenerationSnapshotMock: vi.fn(),
  thumbnailRequestMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
  isConnectedModeMock: vi.fn(),
  getBackendUrlMock: vi.fn(),
  getConnectedOrganizationIdMock: vi.fn(),
  getSessionTokenMock: vi.fn(),
  getStudioIdMock: vi.fn(),
}));

vi.mock("../../opencode/index.js", () => ({
  agentEventEmitter: {
    subscribeToSession: subscribeToSessionMock,
    isSessionCompleted: isSessionCompletedMock,
  },
  deleteSession: deleteSessionMock,
  getSessionContent: getSessionContentMock,
  getSessionsStatus: getSessionsStatusMock,
  listQuestions: listQuestionsMock,
  listSessions: listSessionsMock,
  runTask: runTaskMock,
}));

vi.mock("../sync/ArtifactSyncService.js", () => ({
  syncSourceToBucket: syncSourceToBucketMock,
  buildAndUploadPreview: buildAndUploadPreviewMock,
}));

vi.mock("../sync/AgentTaskSyncService.js", () => ({
  requestBucketSync: requestBucketSyncMock,
}));

vi.mock("./InitialGenerationSnapshotService.js", () => ({
  saveInitialGenerationSnapshot: saveInitialGenerationSnapshotMock,
}));

vi.mock("../reporting/ThumbnailGenerationReporter.js", () => ({
  thumbnailGenerationReporter: {
    request: thumbnailRequestMock,
  },
}));

vi.mock("../project/projectType.js", () => ({
  detectProjectType: detectProjectTypeMock,
}));

vi.mock("@vivd/shared", async () => {
  return {
    INITIAL_GENERATION_MANIFEST_RELATIVE_PATH: ".vivd/initial-generation.json",
    SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH: "src/content/media/shared",
    SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH: "images",
    SCRATCH_REFERENCE_FILES_RELATIVE_PATH: "references",
    isConnectedMode: isConnectedModeMock,
    getBackendUrl: getBackendUrlMock,
    getConnectedOrganizationId: getConnectedOrganizationIdMock,
    getSessionToken: getSessionTokenMock,
    getStudioId: getStudioIdMock,
  };
});

import {
  buildInitialGenerationTask,
  initialGenerationService,
} from "./InitialGenerationService.js";

const MANIFEST_PATH = path.join(".vivd", "initial-generation.json");

function writeManifest(tmpDir: string, partial: Record<string, unknown> = {}) {
  const manifest = {
    version: 1,
    flow: "scratch",
    mode: "studio_astro",
    state: "starting_studio",
    title: "Acme Studio",
    description: "A minimal site for Acme.",
    sessionId: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    ...partial,
  };

  fs.mkdirSync(path.join(tmpDir, ".vivd"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

function readManifest(tmpDir: string) {
  return JSON.parse(
    fs.readFileSync(path.join(tmpDir, MANIFEST_PATH), "utf-8"),
  ) as Record<string, unknown>;
}

function mockCompletedSessionState(sessionId = "sess-1") {
  const now = Date.now();
  getSessionsStatusMock.mockResolvedValue({
    [sessionId]: { type: "idle" },
  });
  getSessionContentMock.mockResolvedValue([
    {
      info: {
        id: "msg-user",
        role: "user",
        time: {
          created: now - 5_000,
          updated: now - 5_000,
          completed: now - 5_000,
        },
      },
      parts: [{ type: "text", text: "Create the initial site" }],
    },
    {
      info: {
        id: "msg-assistant",
        role: "assistant",
        finish: "stop",
        time: {
          created: now - 4_000,
          updated: now - 1_000,
          completed: now - 1_000,
        },
      },
      parts: [{ type: "text", text: "Done" }],
    },
  ]);
}

async function flushAsyncWork() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

describe("InitialGenerationService", () => {
  let tmpDir: string;
  let sessionListener:
    | ((event: { type: string; data: Record<string, unknown> }) => void)
    | null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-initial-generation-"));
    sessionListener = null;

    runTaskMock.mockReset();
    deleteSessionMock.mockReset();
    getSessionContentMock.mockReset();
    listSessionsMock.mockReset();
    listQuestionsMock.mockReset();
    getSessionsStatusMock.mockReset();
    subscribeToSessionMock.mockReset();
    isSessionCompletedMock.mockReset();
    syncSourceToBucketMock.mockReset();
    buildAndUploadPreviewMock.mockReset();
    requestBucketSyncMock.mockReset();
    saveInitialGenerationSnapshotMock.mockReset();
    thumbnailRequestMock.mockReset();
    detectProjectTypeMock.mockReset();
    isConnectedModeMock.mockReset();
    getBackendUrlMock.mockReset();
    getConnectedOrganizationIdMock.mockReset();
    getSessionTokenMock.mockReset();
    getStudioIdMock.mockReset();

    runTaskMock.mockResolvedValue({ sessionId: "sess-1" });
    deleteSessionMock.mockResolvedValue(true);
    getSessionContentMock.mockResolvedValue([]);
    listSessionsMock.mockResolvedValue([]);
    listQuestionsMock.mockResolvedValue([]);
    getSessionsStatusMock.mockResolvedValue({});
    subscribeToSessionMock.mockImplementation((_sessionId, callback) => {
      sessionListener = callback;
      return vi.fn();
    });
    isSessionCompletedMock.mockReturnValue(false);
    detectProjectTypeMock.mockReturnValue({ framework: "astro" });
    syncSourceToBucketMock.mockResolvedValue(undefined);
    buildAndUploadPreviewMock.mockResolvedValue(undefined);
    requestBucketSyncMock.mockReturnValue(true);
    saveInitialGenerationSnapshotMock.mockResolvedValue({
      commitHash: "head-1234567",
      createdCommit: true,
    });
    isConnectedModeMock.mockReturnValue(false);
    getBackendUrlMock.mockReturnValue("");
    getConnectedOrganizationIdMock.mockReturnValue(undefined);
    getSessionTokenMock.mockReturnValue("");
    getStudioIdMock.mockReturnValue("");

    writeManifest(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, "scratch_brief.txt"),
      "Title: Acme Studio\n\nDescription:\nA modern studio landing page.\n",
      "utf-8",
    );
    fs.mkdirSync(path.join(tmpDir, "src", "content", "media", "shared"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, "src", "content", "media", "shared", "logo.png"),
      "fake",
      "utf-8",
    );
    fs.mkdirSync(path.join(tmpDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "references", "urls.txt"),
      "https://example.com\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("builds the initial-generation task from local workspace files", () => {
    const task = buildInitialGenerationTask({
      workspaceDir: tmpDir,
      manifest: readManifest(tmpDir) as any,
    });

    expect(task).toContain("Create a complete, finished version 1");
    expect(task).toContain("you may ask the user clarifying questions");
    expect(task).toContain("scratch_brief.txt");
    expect(task).toContain("src/content/media/shared/logo.png");
    expect(task).toContain("canonical home for Astro-managed site assets");
    expect(task).toContain("Prefer Astro's `Image` component from `astro:assets`");
    expect(task).toContain("https://example.com");
    expect(task).toContain("AGENTS.md");
  });

  it("starts a new session, records it, and finalizes artifacts on completion", async () => {
    const result = await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
      model: { provider: "openai", modelId: "gpt-5.4", variant: "high" },
    });

    expect(result).toEqual({
      sessionId: "sess-1",
      reused: false,
      status: "generating_initial_site",
    });
    expect(runTaskMock).toHaveBeenCalledTimes(1);
    expect(runTaskMock).toHaveBeenCalledWith(
      expect.stringContaining("Acme Studio"),
      tmpDir,
      undefined,
      { provider: "openai", modelId: "gpt-5.4", variant: "high" },
    );
    expect(requestBucketSyncMock).toHaveBeenCalledWith(
      "initial-generation-state",
      expect.objectContaining({
        projectDir: tmpDir,
        projectSlug: "site-1",
        version: 1,
        state: "generating_initial_site",
        sessionId: "sess-1",
      }),
    );

    const startedManifest = readManifest(tmpDir);
    expect(startedManifest.state).toBe("generating_initial_site");
    expect(startedManifest.sessionId).toBe("sess-1");

    expect(sessionListener).toBeTypeOf("function");
    mockCompletedSessionState();
    sessionListener?.({
      type: "session.completed",
      data: { kind: "session.completed" },
    });
    await flushAsyncWork();

    expect(saveInitialGenerationSnapshotMock).toHaveBeenCalledWith(tmpDir);
    expect(syncSourceToBucketMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
      commitHash: "head-1234567",
    });
    expect(buildAndUploadPreviewMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
      commitHash: "head-1234567",
    });
    expect(thumbnailRequestMock).toHaveBeenCalledWith("site-1", 1);
    expect(requestBucketSyncMock).toHaveBeenCalledWith(
      "initial-generation-state",
      expect.objectContaining({
        projectDir: tmpDir,
        projectSlug: "site-1",
        version: 1,
        state: "completed",
        sessionId: "sess-1",
      }),
    );

    const completedManifest = readManifest(tmpDir);
    expect(completedManifest.state).toBe("completed");
    expect(completedManifest.sessionId).toBe("sess-1");
  });

  it("builds the preview artifact locally after source sync completes", async () => {
    await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
      model: { provider: "openai", modelId: "gpt-5.4", variant: "high" },
    });

    mockCompletedSessionState();
    sessionListener?.({
      type: "session.completed",
      data: { kind: "session.completed" },
    });
    await flushAsyncWork();

    expect(syncSourceToBucketMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
      commitHash: "head-1234567",
    });
    expect(buildAndUploadPreviewMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
      commitHash: "head-1234567",
    });
  });

  it("continues finalization when the completion snapshot save fails", async () => {
    saveInitialGenerationSnapshotMock.mockRejectedValueOnce(
      new Error("index.lock still present"),
    );

    await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
    });

    mockCompletedSessionState();
    sessionListener?.({
      type: "session.completed",
      data: { kind: "session.completed" },
    });
    await flushAsyncWork();

    expect(syncSourceToBucketMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
      commitHash: undefined,
    });
    expect(buildAndUploadPreviewMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
      commitHash: undefined,
    });

    const completedManifest = readManifest(tmpDir);
    expect(completedManifest.state).toBe("completed");
  });

  it("reuses an existing session idempotently instead of creating a duplicate run", async () => {
    writeManifest(tmpDir, {
      state: "starting_studio",
      sessionId: "sess-existing",
    });
    listSessionsMock.mockResolvedValue([{ id: "sess-existing" }]);
    getSessionsStatusMock.mockResolvedValue({
      "sess-existing": { type: "busy" },
    });

    const first = await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
    });
    const second = await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
    });

    expect(first).toEqual({
      sessionId: "sess-existing",
      reused: true,
      status: "generating_initial_site",
    });
    expect(second).toEqual(first);
    expect(runTaskMock).not.toHaveBeenCalled();

    const manifest = readManifest(tmpDir);
    expect(manifest.state).toBe("generating_initial_site");
    expect(manifest.sessionId).toBe("sess-existing");
  });

  it("waits briefly for the initial-generation manifest to appear before failing", async () => {
    vi.stubEnv("VIVD_INITIAL_GENERATION_MANIFEST_WAIT_MS", "500");
    runTaskMock.mockResolvedValueOnce({ sessionId: "sess-manifest-wait" });
    fs.rmSync(path.join(tmpDir, MANIFEST_PATH), { force: true });

    const timer = setTimeout(() => {
      writeManifest(tmpDir);
    }, 50);

    try {
      const result = await initialGenerationService.startInitialGeneration({
        projectSlug: "site-1",
        version: 1,
        workspaceDir: tmpDir,
        model: { provider: "openai", modelId: "gpt-5.4", variant: "high" },
      });

      expect(result).toEqual({
        sessionId: "sess-manifest-wait",
        reused: false,
        status: "generating_initial_site",
      });
      expect(runTaskMock).toHaveBeenCalledTimes(1);

      mockCompletedSessionState("sess-manifest-wait");
      sessionListener?.({
        type: "session.completed",
        data: { kind: "session.completed" },
      });
      await flushAsyncWork();
    } finally {
      clearTimeout(timer);
    }
  });

  it("marks interrupted initial-generation sessions as paused when the runtime goes idle with a terminal assistant error", async () => {
    vi.useFakeTimers();
    getSessionsStatusMock.mockResolvedValue({
      "sess-1": {
        type: "error",
        message:
          'JSON error injected into SSE stream {"code":503,"metadata":{"error_type":"provider_overloaded"}}',
      },
    });
    getSessionContentMock.mockResolvedValue([
      {
        info: {
          id: "msg-user",
          role: "user",
          time: {
            created: Date.now() - 20_000,
            updated: Date.now() - 20_000,
            completed: Date.now() - 20_000,
          },
        },
        parts: [{ type: "text", text: "Create the initial site" }],
      },
      {
        info: {
          id: "msg-assistant",
          role: "assistant",
          time: {
            created: Date.now() - 15_000,
            updated: Date.now() - 15_000,
          },
          error: {
            message:
              'JSON error injected into SSE stream {"code":503,"metadata":{"error_type":"provider_overloaded"}}',
          },
        },
        parts: [{ type: "reasoning", text: "Thinking" }],
      },
    ]);

    await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
    });

    await flushAsyncWork();
    await vi.runOnlyPendingTimersAsync();
    await flushAsyncWork();

    const manifest = readManifest(tmpDir);
    expect(manifest.state).toBe("initial_generation_paused");
    expect(manifest.sessionId).toBe("sess-1");
    expect(manifest.errorMessage).toBe(
      "The AI provider stopped this run before the initial site finished. Open Studio to continue the session.",
    );
    vi.useRealTimers();
  });

  it("ignores premature session.completed events while the latest assistant message is unfinished", async () => {
    getSessionsStatusMock.mockResolvedValue({
      "sess-1": { type: "idle" },
    });
    getSessionContentMock.mockResolvedValue([
      {
        info: {
          id: "msg-user",
          role: "user",
          time: {
            created: Date.now() - 20_000,
            updated: Date.now() - 20_000,
            completed: Date.now() - 20_000,
          },
        },
        parts: [{ type: "text", text: "Create the initial site" }],
      },
      {
        info: {
          id: "msg-assistant",
          role: "assistant",
          time: {
            created: Date.now() - 10_000,
            updated: Date.now() - 2_000,
          },
        },
        parts: [{ type: "reasoning", text: "Still working" }],
      },
    ]);

    await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
    });

    sessionListener?.({
      type: "session.completed",
      data: { kind: "session.completed" },
    });
    await flushAsyncWork();

    const manifest = readManifest(tmpDir);
    expect(manifest.state).toBe("generating_initial_site");
    expect(saveInitialGenerationSnapshotMock).not.toHaveBeenCalled();
    expect(syncSourceToBucketMock).not.toHaveBeenCalled();
    expect(buildAndUploadPreviewMock).not.toHaveBeenCalled();
  });

  it("drops a stale empty startup session and starts a fresh visible session", async () => {
    writeManifest(tmpDir, {
      state: "generating_initial_site",
      sessionId: "sess-stale",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    });
    listSessionsMock.mockResolvedValue([{ id: "sess-stale" }]);
    getSessionsStatusMock.mockResolvedValue({
      "sess-stale": { type: "idle" },
    });
    getSessionsStatusMock.mockImplementation(async (workspaceDir: string) =>
      workspaceDir === tmpDir
        ? { "sess-stale": { type: "idle" }, "sess-fresh": { type: "busy" } }
        : {},
    );
    getSessionContentMock.mockImplementation(async (sessionId: string) =>
      sessionId === "sess-stale"
        ? [
            {
              info: {
                id: "msg-user",
                role: "user",
                time: {
                  created: Date.now() - 30_000,
                  updated: Date.now() - 30_000,
                  completed: Date.now() - 30_000,
                },
              },
              parts: [{ type: "text", text: "Create the initial site" }],
            },
            {
              info: {
                id: "msg-assistant",
                role: "assistant",
                time: {
                  created: Date.now() - 25_000,
                },
              },
              parts: [],
            },
          ]
        : [],
    );
    runTaskMock.mockResolvedValueOnce({ sessionId: "sess-fresh" });

    const result = await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
    });

    expect(deleteSessionMock).toHaveBeenCalledWith("sess-stale", tmpDir);
    expect(runTaskMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sessionId: "sess-fresh",
      reused: false,
      status: "generating_initial_site",
    });

    const manifest = readManifest(tmpDir);
    expect(manifest.state).toBe("generating_initial_site");
    expect(manifest.sessionId).toBe("sess-fresh");
  });

  it("reuses an interrupted partial initial-generation run instead of creating a duplicate session", async () => {
    writeManifest(tmpDir, {
      state: "generating_initial_site",
      sessionId: "sess-stale",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    });
    listSessionsMock.mockResolvedValue([{ id: "sess-stale" }]);
    getSessionsStatusMock.mockImplementation(async (workspaceDir: string) =>
      workspaceDir === tmpDir
        ? { "sess-stale": { type: "idle" }, "sess-fresh": { type: "busy" } }
        : {},
    );
    getSessionContentMock.mockImplementation(async (sessionId: string) =>
      sessionId === "sess-stale"
        ? [
            {
              info: {
                id: "msg-user",
                role: "user",
                time: {
                  created: Date.now() - 30_000,
                  updated: Date.now() - 30_000,
                  completed: Date.now() - 30_000,
                },
              },
              parts: [{ type: "text", text: "Create the initial site" }],
            },
            {
              info: {
                id: "msg-assistant",
                role: "assistant",
                time: {
                  created: Date.now() - 25_000,
                  updated: Date.now() - 25_000,
                },
              },
              parts: [{ type: "reasoning", text: "Inspecting the workspace" }],
            },
          ]
        : [],
    );
    const result = await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
    });

    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(runTaskMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionId: "sess-stale",
      reused: true,
      status: "initial_generation_paused",
    });

    const manifest = readManifest(tmpDir);
    expect(manifest.state).toBe("initial_generation_paused");
    expect(manifest.sessionId).toBe("sess-stale");
    expect(manifest.errorMessage).toBe(
      "The agent stopped before finishing the initial generation. Open Studio to continue the session.",
    );
  });

  it("returns null for handoff when the stored session is a dead empty startup artifact", async () => {
    writeManifest(tmpDir, {
      state: "generating_initial_site",
      sessionId: "sess-stale",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    });
    listSessionsMock.mockResolvedValue([{ id: "sess-stale" }]);
    getSessionsStatusMock.mockResolvedValue({
      "sess-stale": { type: "idle" },
    });
    getSessionContentMock.mockResolvedValue([
      {
        info: {
          id: "msg-user",
          role: "user",
          time: {
            created: Date.now() - 30_000,
            updated: Date.now() - 30_000,
            completed: Date.now() - 30_000,
          },
        },
        parts: [{ type: "text", text: "Create the initial site" }],
      },
      {
        info: {
          id: "msg-assistant",
          role: "assistant",
          time: {
            created: Date.now() - 25_000,
          },
        },
        parts: [],
      },
    ]);

    const sessionId =
      await initialGenerationService.resolveInitialGenerationSessionForHandoff({
        projectSlug: "site-1",
        version: 1,
        workspaceDir: tmpDir,
      });

    expect(sessionId).toBeNull();
    expect(deleteSessionMock).toHaveBeenCalledWith("sess-stale", tmpDir);
    expect(runTaskMock).not.toHaveBeenCalled();

    const manifest = readManifest(tmpDir);
    expect(manifest.state).toBe("initial_generation_paused");
    expect(manifest.sessionId).toBeNull();
  });

  it("returns the interrupted session for handoff so Studio can continue it", async () => {
    writeManifest(tmpDir, {
      state: "generating_initial_site",
      sessionId: "sess-stale",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    });
    listSessionsMock.mockResolvedValue([{ id: "sess-stale" }]);
    getSessionsStatusMock.mockResolvedValue({
      "sess-stale": { type: "idle" },
    });
    getSessionContentMock.mockResolvedValue([
      {
        info: {
          id: "msg-user",
          role: "user",
          time: {
            created: Date.now() - 30_000,
            updated: Date.now() - 30_000,
            completed: Date.now() - 30_000,
          },
        },
        parts: [{ type: "text", text: "Create the initial site" }],
      },
      {
        info: {
          id: "msg-assistant",
          role: "assistant",
          time: {
            created: Date.now() - 25_000,
            updated: Date.now() - 25_000,
          },
        },
        parts: [{ type: "reasoning", text: "Inspecting the workspace" }],
      },
    ]);

    const sessionId =
      await initialGenerationService.resolveInitialGenerationSessionForHandoff({
        projectSlug: "site-1",
        version: 1,
        workspaceDir: tmpDir,
      });

    expect(sessionId).toBe("sess-stale");
    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(runTaskMock).not.toHaveBeenCalled();

    const manifest = readManifest(tmpDir);
    expect(manifest.state).toBe("initial_generation_paused");
    expect(manifest.sessionId).toBe("sess-stale");
    expect(manifest.errorMessage).toBe(
      "The agent stopped before finishing the initial generation. Open Studio to continue the session.",
    );
  });
});
