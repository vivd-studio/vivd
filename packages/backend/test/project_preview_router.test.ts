import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolvePublishableArtifactStateMock,
  getProjectMock,
  getActiveTenantHostForOrganizationMock,
  inferTenantBaseDomainFromHostMock,
  isDevDomainMock,
} = vi.hoisted(() => ({
  resolvePublishableArtifactStateMock: vi.fn(),
  getProjectMock: vi.fn(),
  getActiveTenantHostForOrganizationMock: vi.fn(),
  inferTenantBaseDomainFromHostMock: vi.fn(),
  isDevDomainMock: vi.fn(),
}));

vi.mock("../src/services/project/ProjectArtifactStateService", () => ({
  resolvePublishableArtifactState: resolvePublishableArtifactStateMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    getProject: getProjectMock,
  },
}));

vi.mock("../src/services/publish/DomainService", () => ({
  domainService: {
    getActiveTenantHostForOrganization: getActiveTenantHostForOrganizationMock,
    inferTenantBaseDomainFromHost: inferTenantBaseDomainFromHostMock,
  },
}));

vi.mock("../src/services/publish/PublishService", () => ({
  publishService: {
    isDevDomain: isDevDomainMock,
  },
}));

import { router } from "../src/trpc";
import { previewProcedures } from "../src/trpcRouters/project/preview";

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

describe("project preview router", () => {
  const previewRouter = router({
    getExternalPreviewStatus: previewProcedures.getExternalPreviewStatus,
  });

  beforeEach(() => {
    resolvePublishableArtifactStateMock.mockReset();
    getProjectMock.mockReset();
    getActiveTenantHostForOrganizationMock.mockReset();
    inferTenantBaseDomainFromHostMock.mockReset();
    isDevDomainMock.mockReset();

    resolvePublishableArtifactStateMock.mockResolvedValue({
      storageEnabled: true,
      readiness: "ready",
      sourceKind: "preview",
      framework: "astro",
      commitHash: "commit-1",
      builtAt: "2026-03-30T08:00:00.000Z",
      previewCommitHash: "commit-1",
      sourceCommitHash: "commit-1",
      previewBuiltAt: "2026-03-30T08:00:00.000Z",
      sourceBuiltAt: "2026-03-30T08:00:00.000Z",
      error: null,
      previewStatus: "success",
      sourceStatus: "success",
    });
    getProjectMock.mockResolvedValue({
      slug: "site-1",
      publicPreviewEnabled: false,
    });
    getActiveTenantHostForOrganizationMock.mockResolvedValue(
      "preview.vivd.local",
    );
    inferTenantBaseDomainFromHostMock.mockReturnValue("vivd.local");
    isDevDomainMock.mockReturnValue(false);
  });

  it("returns a same-host embedded URL and a canonical tenant-host URL", async () => {
    const caller = previewRouter.createCaller(makeContext());

    const result = await caller.getExternalPreviewStatus({
      slug: "site-1",
      version: 1,
    });

    expect(result).toMatchObject({
      status: "ready",
      url: "/vivd-studio/api/preview/site-1/v1/",
      canonicalUrl: "https://preview.vivd.local/vivd-studio/api/preview/site-1/v1/",
      publicPreviewEnabled: false,
    });
    expect(inferTenantBaseDomainFromHostMock).toHaveBeenCalledWith("app.vivd.local");
  });
});
