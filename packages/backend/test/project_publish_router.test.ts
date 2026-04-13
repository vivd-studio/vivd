import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensurePublishDomainEnabledMock,
  listOrganizationDomainsMock,
  isRunningMock,
  getRecentMock,
  publishMock,
  getPublishedInfoMock,
  isDomainAvailableMock,
  isDevDomainMock,
  resolvePolicyMock,
  getResolvedSettingsMock,
  PublishConflictErrorMock,
  getPublishChecklistMock,
  upsertPublishChecklistMock,
} = vi.hoisted(() => ({
  ensurePublishDomainEnabledMock: vi.fn(),
  listOrganizationDomainsMock: vi.fn(),
  isRunningMock: vi.fn(),
  getRecentMock: vi.fn(),
  publishMock: vi.fn(),
  getPublishedInfoMock: vi.fn(),
  isDomainAvailableMock: vi.fn(),
  isDevDomainMock: vi.fn(),
  resolvePolicyMock: vi.fn(),
  getResolvedSettingsMock: vi.fn(() => ({
    publicHost: "solo.example.com",
    publicOrigin: "https://solo.example.com",
    tlsMode: "managed",
    acmeEmail: null,
    sources: {
      publicHost: "settings",
      tlsMode: "settings",
      acmeEmail: "default",
    },
    deploymentManaged: {
      publicHost: false,
    },
  })),
  getPublishChecklistMock: vi.fn(),
  upsertPublishChecklistMock: vi.fn(),
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
    listOrganizationDomains: listOrganizationDomainsMock,
    normalizeDomain: (value: string) => value.trim().toLowerCase(),
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
    getPublishedInfo: getPublishedInfoMock,
    isDevDomain: isDevDomainMock,
    normalizeDomain: vi.fn(),
    validateDomain: vi.fn(),
    isDomainAvailable: isDomainAvailableMock,
  },
  PublishConflictError: PublishConflictErrorMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    getPublishChecklist: getPublishChecklistMock,
    upsertPublishChecklist: upsertPublishChecklistMock,
    getProjectVersion: vi.fn(),
  },
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    resolvePolicy: resolvePolicyMock,
  },
}));

vi.mock("../src/services/system/InstanceNetworkSettingsService", () => ({
  instanceNetworkSettingsService: {
    getResolvedSettings: getResolvedSettingsMock,
  },
}));

import { router } from "../src/trpc";
import { projectPublishProcedures } from "../src/trpcRouters/project/publish";

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
    publishTargets: projectPublishProcedures.publishTargets,
    updatePublishChecklistItem: projectPublishProcedures.updatePublishChecklistItem,
  });

  beforeEach(() => {
    ensurePublishDomainEnabledMock.mockReset();
    listOrganizationDomainsMock.mockReset();
    isRunningMock.mockReset();
    getRecentMock.mockReset();
    publishMock.mockReset();
    getPublishedInfoMock.mockReset();
    isDomainAvailableMock.mockReset();
    isDevDomainMock.mockReset();
    resolvePolicyMock.mockReset();
    getResolvedSettingsMock.mockReset();
    getPublishChecklistMock.mockReset();
    upsertPublishChecklistMock.mockReset();

    ensurePublishDomainEnabledMock.mockResolvedValue({ enabled: true });
    listOrganizationDomainsMock.mockResolvedValue([]);
    isRunningMock.mockResolvedValue(false);
    getRecentMock.mockReturnValue(null);
    publishMock.mockResolvedValue({
      success: true,
      domain: "example.com",
      commitHash: "abc123",
      url: "https://example.com",
      message: "Published",
    });
    getPublishedInfoMock.mockResolvedValue(null);
    isDomainAvailableMock.mockResolvedValue(true);
    isDevDomainMock.mockReturnValue(false);
    resolvePolicyMock.mockResolvedValue({
      installProfile: "platform",
      singleProjectMode: false,
      capabilities: {
        multiOrg: true,
        tenantHosts: true,
        customDomains: true,
        orgLimitOverrides: true,
        orgPluginEntitlements: true,
        projectPluginEntitlements: true,
        dedicatedPluginHost: true,
      },
      pluginDefaults: {},
      limitDefaults: {},
      controlPlane: { mode: "host_based" },
      pluginRuntime: { mode: "dedicated_host" },
    });
    getResolvedSettingsMock.mockReturnValue({
      publicHost: "solo.example.com",
      publicOrigin: "https://solo.example.com",
      tlsMode: "managed",
      acmeEmail: null,
      sources: {
        publicHost: "settings",
        tlsMode: "settings",
        acmeEmail: "default",
      },
      deploymentManaged: {
        publicHost: false,
      },
    });
    getPublishChecklistMock.mockResolvedValue({
      projectSlug: "site-1",
      version: 1,
      runAt: "2026-01-01T00:00:00.000Z",
      snapshotCommitHash: "commit-1",
      items: [
        { id: "imprint", label: "Imprint", status: "pass", note: "ok" },
        { id: "privacy", label: "Privacy", status: "fail", note: "missing page" },
        { id: "seo_meta", label: "SEO", status: "warning", note: "OG missing" },
        { id: "sitemap", label: "Sitemap", status: "skip", note: "single page" },
        { id: "other_issues", label: "Other", status: "fixed", note: "resolved" },
      ],
      summary: {
        passed: 1,
        failed: 1,
        warnings: 1,
        skipped: 1,
        fixed: 1,
      },
    });
    upsertPublishChecklistMock.mockResolvedValue(undefined);
  });

  it("lists recommended publish targets for platform projects", async () => {
    listOrganizationDomainsMock.mockResolvedValueOnce([
      {
        id: "dom-tenant",
        domain: "acme.vivd.studio",
        organizationId: "org-1",
        usage: "tenant_host",
        type: "managed_subdomain",
        status: "active",
      },
      {
        id: "dom-custom",
        domain: "marketing.example.com",
        organizationId: "org-1",
        usage: "publish_target",
        type: "custom_domain",
        status: "active",
      },
      {
        id: "dom-pending",
        domain: "pending.example.com",
        organizationId: "org-1",
        usage: "publish_target",
        type: "custom_domain",
        status: "pending_verification",
      },
    ]);
    ensurePublishDomainEnabledMock.mockImplementation(async ({ domain }: { domain: string }) => {
      if (domain === "pending.example.com") {
        return {
          enabled: false,
          normalizedDomain: domain,
          message: "This domain isn't verified yet. Verify it before publishing.",
        };
      }
      return {
        enabled: true,
        normalizedDomain: domain,
        usage: domain === "acme.vivd.studio" ? "tenant_host" : "publish_target",
      };
    });
    isDomainAvailableMock.mockImplementation(async (domain: string) => domain !== "marketing.example.com");

    const caller = publishRouter.createCaller(makeContext());
    const result = await caller.publishTargets({ slug: "site-1" });

    expect(result.currentPublishedDomain).toBeNull();
    expect(result.recommendedDomain).toBe("acme.vivd.studio");
    expect(result.targets).toEqual([
      expect.objectContaining({
        domain: "acme.vivd.studio",
        usage: "tenant_host",
        available: true,
        recommended: true,
      }),
      expect.objectContaining({
        domain: "marketing.example.com",
        usage: "publish_target",
        available: false,
        blockedReason: "Domain is already in use",
        recommended: false,
      }),
      expect.objectContaining({
        domain: "pending.example.com",
        usage: "publish_target",
        available: false,
        blockedReason: "This domain isn't verified yet. Verify it before publishing.",
        recommended: false,
      }),
    ]);
  });

  it("includes the solo primary host as a publish target", async () => {
    resolvePolicyMock.mockResolvedValueOnce({
      installProfile: "solo",
      singleProjectMode: false,
      capabilities: {
        multiOrg: false,
        tenantHosts: false,
        customDomains: true,
        orgLimitOverrides: false,
        orgPluginEntitlements: false,
        projectPluginEntitlements: false,
        dedicatedPluginHost: false,
      },
      pluginDefaults: {},
      limitDefaults: {},
      controlPlane: { mode: "path_based" },
      pluginRuntime: { mode: "same_host_path" },
    });

    const caller = publishRouter.createCaller(makeContext());
    const result = await caller.publishTargets({ slug: "site-1" });

    expect(result.recommendedDomain).toBe("solo.example.com");
    expect(result.targets).toEqual([
      expect.objectContaining({
        domain: "solo.example.com",
        type: "implicit_primary_host",
        primaryHost: true,
        available: true,
        recommended: true,
      }),
    ]);
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

  it("returns NOT_FOUND when checklist does not exist for item updates", async () => {
    getPublishChecklistMock.mockResolvedValueOnce(null);
    const caller = publishRouter.createCaller(makeContext());

    await expect(
      caller.updatePublishChecklistItem({
        slug: "site-1",
        version: 1,
        itemId: "privacy",
        status: "pass",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      cause: { reason: "checklist_missing" },
    });
    expect(upsertPublishChecklistMock).not.toHaveBeenCalled();
  });

  it("returns BAD_REQUEST when item id is unknown", async () => {
    const caller = publishRouter.createCaller(makeContext());

    await expect(
      caller.updatePublishChecklistItem({
        slug: "site-1",
        version: 1,
        itemId: "unknown-item",
        status: "pass",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      cause: {
        reason: "unknown_item_id",
        validItemIds: ["imprint", "privacy", "seo_meta", "sitemap", "other_issues"],
      },
    });
    expect(upsertPublishChecklistMock).not.toHaveBeenCalled();
  });

  it("updates one checklist item and recomputes summary server-side", async () => {
    const caller = publishRouter.createCaller(makeContext());

    const result = await caller.updatePublishChecklistItem({
      slug: "site-1",
      version: 1,
      itemId: "privacy",
      status: "pass",
      note: "privacy page now exists",
    });

    expect(result.item).toEqual({
      id: "privacy",
      label: "Privacy",
      status: "pass",
      note: "privacy page now exists",
    });
    expect(result.checklist.summary).toEqual({
      passed: 2,
      failed: 0,
      warnings: 1,
      skipped: 1,
      fixed: 1,
    });
    expect(upsertPublishChecklistMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      checklist: expect.objectContaining({
        projectSlug: "site-1",
        version: 1,
        summary: {
          passed: 2,
          failed: 0,
          warnings: 1,
          skipped: 1,
          fixed: 1,
        },
      }),
    });
  });

  it("normalizes blank note to undefined", async () => {
    const caller = publishRouter.createCaller(makeContext());

    const result = await caller.updatePublishChecklistItem({
      slug: "site-1",
      version: 1,
      itemId: "seo_meta",
      status: "warning",
      note: "   ",
    });

    expect(result.item.note).toBeUndefined();
  });
});
