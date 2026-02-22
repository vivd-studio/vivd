import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensurePublishDomainEnabledMock,
  isRunningMock,
  getRecentMock,
  publishMock,
  PublishConflictErrorMock,
} = vi.hoisted(() => ({
  ensurePublishDomainEnabledMock: vi.fn(),
  isRunningMock: vi.fn(),
  getRecentMock: vi.fn(),
  publishMock: vi.fn(),
  PublishConflictErrorMock: class PublishConflictError extends Error {
    reason: "build_in_progress" | "artifact_not_ready" | "artifact_changed";

    constructor(
      reason: "build_in_progress" | "artifact_not_ready" | "artifact_changed",
      message: string,
    ) {
      super(message);
      this.reason = reason;
      this.name = "PublishConflictError";
    }
  },
}));

vi.mock("../src/services/publish/DomainService", () => ({
  domainService: {
    ensurePublishDomainEnabled: ensurePublishDomainEnabledMock,
  },
}));

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: {
    isRunning: isRunningMock,
  },
}));

vi.mock("../src/services/project/StudioWorkspaceStateService", () => ({
  studioWorkspaceStateService: {
    getRecent: getRecentMock,
  },
}));

vi.mock("../src/services/publish/PublishService", () => ({
  publishService: {
    publish: publishMock,
    unpublish: vi.fn(),
    getPublishedInfo: vi.fn(),
    isDevDomain: vi.fn(),
    normalizeDomain: vi.fn(),
    validateDomain: vi.fn(),
    isDomainAvailable: vi.fn(),
  },
  PublishConflictError: PublishConflictErrorMock,
}));

import { router } from "../src/trpc";
import { projectPublishProcedures } from "../src/routers/project/publish";

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

describe("project publish router", () => {
  const publishRouter = router({
    publish: projectPublishProcedures.publish,
  });

  beforeEach(() => {
    ensurePublishDomainEnabledMock.mockReset();
    isRunningMock.mockReset();
    getRecentMock.mockReset();
    publishMock.mockReset();

    ensurePublishDomainEnabledMock.mockResolvedValue({ enabled: true });
    isRunningMock.mockResolvedValue(false);
    getRecentMock.mockReturnValue(null);
    publishMock.mockResolvedValue({
      success: true,
      domain: "example.com",
      commitHash: "abc123",
      url: "https://example.com",
      message: "Published",
    });
  });

  it("returns BAD_REQUEST when the domain is not allowlisted", async () => {
    ensurePublishDomainEnabledMock.mockResolvedValueOnce({
      enabled: false,
      message: "Domain is disabled for this organization",
    });
    const caller = publishRouter.createCaller(makeContext());

    await expect(
      caller.publish({
        slug: "site-1",
        version: 1,
        domain: "example.com",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Domain is disabled for this organization",
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns CONFLICT when studio has unsaved changes", async () => {
    isRunningMock.mockResolvedValueOnce(true);
    getRecentMock.mockReturnValueOnce({
      isFresh: true,
      hasUnsavedChanges: true,
      headCommitHash: "head-1",
      workingCommitHash: "head-1",
      reportedAt: new Date(),
    });
    const caller = publishRouter.createCaller(makeContext());

    await expect(
      caller.publish({
        slug: "site-1",
        version: 1,
        domain: "example.com",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { reason: "studio_unsaved_changes" },
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns CONFLICT when studio is viewing an older snapshot", async () => {
    isRunningMock.mockResolvedValueOnce(true);
    getRecentMock.mockReturnValueOnce({
      isFresh: true,
      hasUnsavedChanges: false,
      headCommitHash: "head-new",
      workingCommitHash: "head-old",
      reportedAt: new Date(),
    });
    const caller = publishRouter.createCaller(makeContext());

    await expect(
      caller.publish({
        slug: "site-1",
        version: 1,
        domain: "example.com",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { reason: "studio_older_snapshot" },
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("maps PublishConflictError from service to CONFLICT", async () => {
    publishMock.mockRejectedValueOnce(
      new PublishConflictErrorMock(
        "artifact_changed",
        "The publishable artifact changed. Refresh status and try again.",
      ),
    );
    const caller = publishRouter.createCaller(makeContext());

    await expect(
      caller.publish({
        slug: "site-1",
        version: 1,
        domain: "example.com",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      cause: { reason: "artifact_changed" },
    });
  });
});
