import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findOrganizationMock,
  selectMock,
  selectFromMock,
  selectWhereMock,
  getProjectMock,
  setPublicPreviewEnabledMock,
  getManifestMock,
  setTagsMock,
  checkLimitsMock,
} = vi.hoisted(() => {
  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  return {
    findOrganizationMock: vi.fn(),
    selectWhereMock,
    selectFromMock,
    selectMock,
    getProjectMock: vi.fn(),
    setPublicPreviewEnabledMock: vi.fn(),
    getManifestMock: vi.fn(),
    setTagsMock: vi.fn(),
    checkLimitsMock: vi.fn(),
  };
});

vi.mock("../src/db", () => ({
  db: {
    query: {
      organization: { findFirst: findOrganizationMock },
    },
    select: selectMock,
  },
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    getProject: getProjectMock,
    setPublicPreviewEnabled: setPublicPreviewEnabledMock,
    setTags: setTagsMock,
  },
}));

vi.mock("../src/generator/versionUtils", () => ({
  getManifest: getManifestMock,
}));

vi.mock("../src/services/usage/LimitsService", () => ({
  limitsService: {
    checkLimits: checkLimitsMock,
  },
}));

import { router } from "../src/trpc";
import { previewProcedures } from "../src/trpcRouters/project/preview";
import { projectTagProcedures } from "../src/trpcRouters/project/tags";
import { usageRouter } from "../src/trpcRouters/usage";

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
        email: "member@example.com",
        name: "Member",
        role: "user",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    requestHost: "app.vivd.local",
    requestDomain: "app.vivd.local",
    isSuperAdminHost: false,
    hostKind: "control_plane_host",
    hostOrganizationId: null,
    hostOrganizationSlug: null,
    canSelectOrganization: true,
    organizationId: "org-1",
    organizationRole: "member",
    ...overrides,
  };
}

describe("project and usage authorization boundaries", () => {
  const previewRouter = router({
    setPublicPreviewEnabled: previewProcedures.setPublicPreviewEnabled,
  });
  const tagsRouter = router({
    updateTags: projectTagProcedures.updateTags,
  });

  beforeEach(() => {
    findOrganizationMock.mockReset();
    selectMock.mockReset();
    selectFromMock.mockReset();
    selectWhereMock.mockReset();
    getProjectMock.mockReset();
    setPublicPreviewEnabledMock.mockReset();
    getManifestMock.mockReset();
    setTagsMock.mockReset();
    checkLimitsMock.mockReset();

    findOrganizationMock.mockResolvedValue({
      id: "org-1",
      status: "active",
    });
    selectWhereMock.mockResolvedValue([]);
    selectFromMock.mockImplementation(() => ({ where: selectWhereMock }));
    selectMock.mockImplementation(() => ({ from: selectFromMock }));
    getProjectMock.mockResolvedValue({
      slug: "site-1",
      publicPreviewEnabled: true,
    });
    getManifestMock.mockResolvedValue({
      url: "https://example.com",
      tags: [],
      versions: [],
      createdAt: new Date().toISOString(),
      currentVersion: 1,
      publicPreviewEnabled: true,
    });
    checkLimitsMock.mockResolvedValue({
      blocked: false,
      warning: false,
      reason: null,
      usage: {},
      limits: {},
    });
  });

  it("blocks non-admin members from toggling public preview URLs", async () => {
    const caller = previewRouter.createCaller(makeContext());

    await expect(
      caller.setPublicPreviewEnabled({ slug: "site-1", enabled: false }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Organization admin access required",
    });

    expect(getProjectMock).not.toHaveBeenCalled();
    expect(setPublicPreviewEnabledMock).not.toHaveBeenCalled();
  });

  it("blocks non-admin members from editing project tags", async () => {
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.updateTags({ slug: "site-1", tags: ["marketing"] }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Organization admin access required",
    });

    expect(getManifestMock).not.toHaveBeenCalled();
    expect(setTagsMock).not.toHaveBeenCalled();
  });

  it("blocks non-admin members from reading organization usage dashboards", async () => {
    const caller = usageRouter.createCaller(makeContext());

    await expect(caller.status()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Organization admin access required",
    });

    expect(checkLimitsMock).not.toHaveBeenCalled();
  });

  it("still allows organization admins to manage preview visibility", async () => {
    const caller = previewRouter.createCaller(
      makeContext({ organizationRole: "admin" }),
    );

    await expect(
      caller.setPublicPreviewEnabled({ slug: "site-1", enabled: false }),
    ).resolves.toEqual({
      success: true,
      slug: "site-1",
      publicPreviewEnabled: false,
    });

    expect(setPublicPreviewEnabledMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site-1",
      enabled: false,
    });
  });
});
