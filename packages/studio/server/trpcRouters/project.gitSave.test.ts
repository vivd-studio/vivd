import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  detectProjectTypeMock,
  syncSourceToBucketMock,
  buildAndUploadPreviewMock,
  syncPushToGitHubMock,
  projectTouchMock,
  reportSoonMock,
} = vi.hoisted(() => ({
  detectProjectTypeMock: vi.fn(),
  syncSourceToBucketMock: vi.fn(),
  buildAndUploadPreviewMock: vi.fn(),
  syncPushToGitHubMock: vi.fn(),
  projectTouchMock: vi.fn(),
  reportSoonMock: vi.fn(),
}));

vi.mock("../services/project/projectType.js", () => ({
  detectProjectType: detectProjectTypeMock,
}));

vi.mock("../services/sync/ArtifactSyncService.js", () => ({
  syncSourceToBucket: syncSourceToBucketMock,
  buildAndUploadPreview: buildAndUploadPreviewMock,
  buildAndUploadPublished: vi.fn(),
}));

vi.mock("../services/integrations/GitHubSyncService.js", () => ({
  checkGitHubRepoExists: vi.fn(),
  getGitHubSyncProjectInfo: vi.fn(),
  sanitizeGitAuthFromMessage: vi.fn((value: string) => value),
  syncPushToGitHub: syncPushToGitHubMock,
}));

vi.mock("../services/reporting/ProjectTouchReporter.js", () => ({
  projectTouchReporter: {
    touch: projectTouchMock,
  },
}));

vi.mock("../services/reporting/WorkspaceStateReporter.js", () => ({
  workspaceStateReporter: {
    reportSoon: reportSoonMock,
  },
}));

vi.mock("../services/reporting/ThumbnailGenerationReporter.js", () => ({
  thumbnailGenerationReporter: {
    request: vi.fn(),
  },
}));

vi.mock("../services/project/DevServerService.js", () => ({
  devServerService: {
    touch: vi.fn(),
    stopDevServer: vi.fn(),
    getOrStartDevServer: vi.fn(),
    restartDevServer: vi.fn(),
  },
}));

vi.mock("../services/sync/SyncPauseService.js", () => ({
  withBucketSyncPaused: vi.fn(async (work: () => Promise<unknown>) => await work()),
}));

vi.mock("../services/sync/AgentTaskSyncService.js", () => ({
  requestBucketSync: vi.fn(),
}));

vi.mock("@vivd/shared", () => ({
  getBackendUrl: vi.fn(),
  getConnectedOrganizationId: vi.fn(),
  getSessionToken: vi.fn(),
  getStudioId: vi.fn(),
  isConnectedMode: vi.fn(() => false),
}));

import { projectRouter } from "./project.js";

describe("project router gitSave", () => {
  beforeEach(() => {
    detectProjectTypeMock.mockReset();
    syncSourceToBucketMock.mockReset();
    buildAndUploadPreviewMock.mockReset();
    syncPushToGitHubMock.mockReset();
    projectTouchMock.mockReset();
    reportSoonMock.mockReset();

    detectProjectTypeMock.mockReturnValue({ framework: "generic" });
    syncSourceToBucketMock.mockResolvedValue(undefined);
    buildAndUploadPreviewMock.mockResolvedValue(undefined);
    syncPushToGitHubMock.mockResolvedValue({
      attempted: true,
      success: true,
      repo: "repo",
      remoteUrl: "https://github.com/org/repo.git",
    });
  });

  it("prepares artifacts when save has no file changes but HEAD exists", async () => {
    const caller = projectRouter.createCaller({
      workspace: {
        isInitialized: vi.fn(() => true),
        commit: vi.fn(async () => ""),
        getHeadCommit: vi.fn(async () => ({ hash: "head-1234567" })),
        getProjectPath: vi.fn(() => "/tmp/workspace"),
        runExclusive: vi.fn(),
      },
    } as any);

    const result = await caller.gitSave({
      slug: "site-1",
      version: 3,
      message: "Prepare publish artifacts",
    });

    expect(result).toMatchObject({
      success: true,
      hash: "",
      noChanges: true,
      github: { attempted: false, success: true },
    });
    expect(result.message).toContain("Preparing artifacts");

    expect(syncSourceToBucketMock).toHaveBeenCalledWith({
      projectDir: "/tmp/workspace",
      slug: "site-1",
      version: 3,
      commitHash: "head-1234567",
    });
    expect(buildAndUploadPreviewMock).not.toHaveBeenCalled();
    expect(syncPushToGitHubMock).not.toHaveBeenCalled();
    expect(projectTouchMock).not.toHaveBeenCalled();
    expect(reportSoonMock).not.toHaveBeenCalled();
  });
});

