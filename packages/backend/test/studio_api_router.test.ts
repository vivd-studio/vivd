import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  recordAiCostMock,
  updateSessionTitleMock,
  checkLimitsMock,
  touchProjectUpdatedAtMock,
  getVersionDirMock,
  generateThumbnailMock,
  upsertPublishChecklistMock,
  getPublishChecklistMock,
  workspaceReportMock,
} = vi.hoisted(() => ({
  recordAiCostMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  checkLimitsMock: vi.fn(),
  touchProjectUpdatedAtMock: vi.fn(),
  getVersionDirMock: vi.fn(),
  generateThumbnailMock: vi.fn(),
  upsertPublishChecklistMock: vi.fn(),
  getPublishChecklistMock: vi.fn(),
  workspaceReportMock: vi.fn(),
}));

vi.mock("../src/services/usage/UsageService", () => ({
  usageService: {
    recordAiCost: recordAiCostMock,
    updateSessionTitle: updateSessionTitleMock,
  },
}));

vi.mock("../src/services/usage/LimitsService", () => ({
  limitsService: {
    checkLimits: checkLimitsMock,
  },
}));

vi.mock("../src/generator/versionUtils", () => ({
  touchProjectUpdatedAt: touchProjectUpdatedAtMock,
  getVersionDir: getVersionDirMock,
}));

vi.mock("../src/services/project/ThumbnailService", () => ({
  thumbnailService: {
    generateThumbnail: generateThumbnailMock,
  },
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    upsertPublishChecklist: upsertPublishChecklistMock,
    getPublishChecklist: getPublishChecklistMock,
  },
}));

vi.mock("../src/services/project/StudioWorkspaceStateService", () => ({
  studioWorkspaceStateService: {
    report: workspaceReportMock,
  },
}));

import { studioApiRouter } from "../src/routers/studioApi";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: {} as any,
    res: {} as any,
    session: {
      session: {
        id: "sess-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
        role: "super_admin",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    requestHost: "app.vivd.local",
    requestDomain: "app.vivd.local",
    isSuperAdminHost: true,
    hostKind: "control_plane_host",
    hostOrganizationId: null,
    hostOrganizationSlug: null,
    canSelectOrganization: true,
    organizationId: "org-1",
    organizationRole: "owner",
    ...overrides,
  };
}

describe("studioApi router", () => {
  beforeEach(() => {
    recordAiCostMock.mockReset();
    updateSessionTitleMock.mockReset();
    checkLimitsMock.mockReset();
    touchProjectUpdatedAtMock.mockReset();
    getVersionDirMock.mockReset();
    generateThumbnailMock.mockReset();
    upsertPublishChecklistMock.mockReset();
    getPublishChecklistMock.mockReset();
    workspaceReportMock.mockReset();

    recordAiCostMock.mockResolvedValue(undefined);
    updateSessionTitleMock.mockResolvedValue(undefined);
    checkLimitsMock.mockResolvedValue({ blocked: false });
    touchProjectUpdatedAtMock.mockResolvedValue(undefined);
    getVersionDirMock.mockReturnValue("/tmp/org-1/site-1/v1");
    generateThumbnailMock.mockResolvedValue(undefined);
    upsertPublishChecklistMock.mockResolvedValue(undefined);
    getPublishChecklistMock.mockResolvedValue(null);
  });

  it("records each usage report with session/project linkage", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    const runAt = new Date().toISOString();

    const result = await caller.reportUsage({
      studioId: "studio-1",
      reports: [
        {
          sessionId: "session-1",
          sessionTitle: "Landing page edits",
          cost: 1.25,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 3,
            cache: { read: 4, write: 5 },
          },
          partId: "part-1",
          projectPath: "site-1",
          timestamp: runAt,
        },
        {
          sessionId: "session-2",
          cost: 0.5,
          timestamp: runAt,
        },
      ],
    });

    expect(recordAiCostMock).toHaveBeenNthCalledWith(
      1,
      "org-1",
      1.25,
      {
        input: 10,
        output: 20,
        reasoning: 3,
        cache: { read: 4, write: 5 },
      },
      "session-1",
      "Landing page edits",
      "site-1",
      "part-1",
    );
    expect(recordAiCostMock).toHaveBeenNthCalledWith(
      2,
      "org-1",
      0.5,
      undefined,
      "session-2",
      undefined,
      undefined,
      undefined,
    );
    expect(result).toEqual({ success: true, recorded: 2 });
  });

  it("updates session title with optional project scope", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    await caller.updateSessionTitle({
      studioId: "studio-1",
      sessionId: "session-1",
      sessionTitle: "New title",
      projectSlug: "site-1",
    });

    expect(updateSessionTitleMock).toHaveBeenCalledWith(
      "org-1",
      "session-1",
      "New title",
      "site-1",
    );
  });

  it("returns current limit status for the active organization", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    const result = await caller.getStatus({ studioId: "studio-1" });

    expect(checkLimitsMock).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({ blocked: false });
  });

  it("keeps generateThumbnail resilient when async side-effects fail", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    touchProjectUpdatedAtMock.mockRejectedValueOnce(new Error("touch failed"));
    getVersionDirMock.mockReturnValueOnce("/tmp/org-1/site-1/v2");
    generateThumbnailMock.mockRejectedValueOnce(new Error("thumbnail failed"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        caller.generateThumbnail({
          studioId: "studio-1",
          slug: "site-1",
          version: 2,
        }),
      ).resolves.toEqual({ success: true });

      expect(touchProjectUpdatedAtMock).toHaveBeenCalledWith("org-1", "site-1");
      expect(getVersionDirMock).toHaveBeenCalledWith("org-1", "site-1", 2);
      expect(generateThumbnailMock).toHaveBeenCalledWith(
        "/tmp/org-1/site-1/v2",
        "org-1",
        "site-1",
        2,
      );

      await new Promise((resolve) => setImmediate(resolve));
      const warningMessages = warnSpy.mock.calls.map((call) => String(call[0] ?? ""));
      expect(
        warningMessages.some((line) => line.includes("touchProjectUpdatedAt failed")),
      ).toBe(true);
      expect(
        warningMessages.some((line) =>
          line.includes("Thumbnail generation failed for site-1/v2"),
        ),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("normalizes missing workspace hashes to null", async () => {
    const caller = studioApiRouter.createCaller(makeContext());

    await caller.reportWorkspaceState({
      studioId: "studio-1",
      slug: "site-1",
      version: 3,
      hasUnsavedChanges: true,
    });

    expect(workspaceReportMock).toHaveBeenCalledWith({
      studioId: "studio-1",
      organizationId: "org-1",
      slug: "site-1",
      version: 3,
      hasUnsavedChanges: true,
      headCommitHash: null,
      workingCommitHash: null,
    });
  });

  it("upserts checklist using slug/version from route input", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    const runAt = new Date().toISOString();

    await caller.upsertPublishChecklist({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
      checklist: {
        projectSlug: "wrong-slug",
        version: 99,
        runAt,
        snapshotCommitHash: "abc123",
        items: [
          {
            id: "lint",
            label: "Lint",
            status: "pass",
          },
        ],
        summary: {
          passed: 1,
          failed: 0,
          warnings: 0,
          skipped: 0,
        },
      },
    });

    expect(upsertPublishChecklistMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      checklist: expect.objectContaining({
        projectSlug: "site-1",
        version: 2,
        runAt,
      }),
    });
  });

  it("returns publish checklist from project metadata service", async () => {
    const caller = studioApiRouter.createCaller(makeContext());
    getPublishChecklistMock.mockResolvedValueOnce({
      projectSlug: "site-1",
      version: 2,
      runAt: new Date().toISOString(),
      items: [],
      summary: { passed: 0, failed: 0, warnings: 0, skipped: 0 },
    });

    const result = await caller.getPublishChecklist({
      studioId: "studio-1",
      slug: "site-1",
      version: 2,
    });

    expect(getPublishChecklistMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site-1",
      version: 2,
    });
    expect(result).toEqual({
      checklist: expect.objectContaining({
        projectSlug: "site-1",
        version: 2,
      }),
    });
  });
});
