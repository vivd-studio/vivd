import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  runTaskMock,
  listSessionsMock,
  getSessionsStatusMock,
  subscribeToSessionMock,
  isSessionCompletedMock,
  syncSourceToBucketMock,
  buildAndUploadPreviewMock,
  requestConnectedArtifactBuildMock,
  thumbnailRequestMock,
  detectProjectTypeMock,
  isConnectedModeMock,
  getBackendUrlMock,
  getConnectedOrganizationIdMock,
  getSessionTokenMock,
  getStudioIdMock,
} = vi.hoisted(() => ({
  runTaskMock: vi.fn(),
  listSessionsMock: vi.fn(),
  getSessionsStatusMock: vi.fn(),
  subscribeToSessionMock: vi.fn(),
  isSessionCompletedMock: vi.fn(),
  syncSourceToBucketMock: vi.fn(),
  buildAndUploadPreviewMock: vi.fn(),
  requestConnectedArtifactBuildMock: vi.fn(),
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
  getSessionsStatus: getSessionsStatusMock,
  listSessions: listSessionsMock,
  runTask: runTaskMock,
}));

vi.mock("../sync/ArtifactSyncService.js", () => ({
  syncSourceToBucket: syncSourceToBucketMock,
  buildAndUploadPreview: buildAndUploadPreviewMock,
}));

vi.mock("../sync/ConnectedArtifactBuildService.js", () => ({
  requestConnectedArtifactBuild: requestConnectedArtifactBuildMock,
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

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
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
    listSessionsMock.mockReset();
    getSessionsStatusMock.mockReset();
    subscribeToSessionMock.mockReset();
    isSessionCompletedMock.mockReset();
    syncSourceToBucketMock.mockReset();
    buildAndUploadPreviewMock.mockReset();
    requestConnectedArtifactBuildMock.mockReset();
    thumbnailRequestMock.mockReset();
    detectProjectTypeMock.mockReset();
    isConnectedModeMock.mockReset();
    getBackendUrlMock.mockReset();
    getConnectedOrganizationIdMock.mockReset();
    getSessionTokenMock.mockReset();
    getStudioIdMock.mockReset();

    runTaskMock.mockResolvedValue({ sessionId: "sess-1" });
    listSessionsMock.mockResolvedValue([]);
    getSessionsStatusMock.mockResolvedValue({});
    subscribeToSessionMock.mockImplementation((_sessionId, callback) => {
      sessionListener = callback;
      return vi.fn();
    });
    isSessionCompletedMock.mockReturnValue(false);
    detectProjectTypeMock.mockReturnValue({ framework: "astro" });
    syncSourceToBucketMock.mockResolvedValue(undefined);
    buildAndUploadPreviewMock.mockResolvedValue(undefined);
    requestConnectedArtifactBuildMock.mockResolvedValue({
      requested: false,
      reason: "disabled",
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
    fs.mkdirSync(path.join(tmpDir, "images"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "images", "logo.png"), "fake", "utf-8");
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
    expect(task).toContain("images/logo.png");
    expect(task).toContain("https://example.com");
    expect(task).toContain("AGENTS.md");
  });

  it("starts a new session, records it, and finalizes artifacts on completion", async () => {
    const result = await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
      model: { provider: "openai", modelId: "gpt-5.4" },
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
      { provider: "openai", modelId: "gpt-5.4" },
    );

    const startedManifest = readManifest(tmpDir);
    expect(startedManifest.state).toBe("generating_initial_site");
    expect(startedManifest.sessionId).toBe("sess-1");

    expect(sessionListener).toBeTypeOf("function");
    sessionListener?.({
      type: "session.completed",
      data: { kind: "session.completed" },
    });
    await flushAsyncWork();

    expect(syncSourceToBucketMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
    });
    expect(buildAndUploadPreviewMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
    });
    expect(thumbnailRequestMock).toHaveBeenCalledWith("site-1", 1);

    const completedManifest = readManifest(tmpDir);
    expect(completedManifest.state).toBe("completed");
    expect(completedManifest.sessionId).toBe("sess-1");
  });

  it("queues the preview build via the connected builder when that path is accepted", async () => {
    requestConnectedArtifactBuildMock.mockResolvedValue({
      requested: true,
      deduped: false,
      status: "queued",
    });

    await initialGenerationService.startInitialGeneration({
      projectSlug: "site-1",
      version: 1,
      workspaceDir: tmpDir,
      model: { provider: "openai", modelId: "gpt-5.4" },
    });

    sessionListener?.({
      type: "session.completed",
      data: { kind: "session.completed" },
    });
    await flushAsyncWork();

    expect(syncSourceToBucketMock).toHaveBeenCalledWith({
      projectDir: tmpDir,
      slug: "site-1",
      version: 1,
    });
    expect(requestConnectedArtifactBuildMock).toHaveBeenCalledWith({
      slug: "site-1",
      version: 1,
      kind: "preview",
    });
    expect(buildAndUploadPreviewMock).not.toHaveBeenCalled();
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
});
