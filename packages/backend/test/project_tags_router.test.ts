import { beforeEach, describe, expect, it, vi } from "vitest";

const { getManifestMock, setTagsMock } = vi.hoisted(() => ({
  getManifestMock: vi.fn(),
  setTagsMock: vi.fn(),
}));

vi.mock("../src/generator/versionUtils", () => ({
  getManifest: getManifestMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    setTags: setTagsMock,
  },
}));

import { router } from "../src/trpc";
import { projectTagProcedures } from "../src/routers/project/tags";

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

describe("project.updateTags", () => {
  const tagsRouter = router({
    updateTags: projectTagProcedures.updateTags,
  });

  beforeEach(() => {
    getManifestMock.mockReset();
    setTagsMock.mockReset();
    getManifestMock.mockResolvedValue({
      url: "https://example.com",
      tags: [],
      versions: [],
      createdAt: new Date().toISOString(),
      currentVersion: 1,
      publicPreviewEnabled: true,
    });
    setTagsMock.mockResolvedValue(undefined);
  });

  it("stores normalized tags", async () => {
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.updateTags({
        slug: "site-1",
        tags: [" #Marketing ", "marketing", "SEO"],
      }),
    ).resolves.toEqual({
      success: true,
      slug: "site-1",
      tags: ["marketing", "seo"],
    });

    expect(setTagsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "site-1",
      tags: ["marketing", "seo"],
    });
  });

  it("returns NOT_FOUND when the project does not exist", async () => {
    getManifestMock.mockResolvedValueOnce(null);
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.updateTags({ slug: "missing", tags: ["marketing"] }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Project not found",
    });
    expect(setTagsMock).not.toHaveBeenCalled();
  });

  it("returns BAD_REQUEST for invalid tags", async () => {
    const caller = tagsRouter.createCaller(makeContext());
    const tooLong = "x".repeat(33);

    await expect(
      caller.updateTags({ slug: "site-1", tags: [tooLong] }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(setTagsMock).not.toHaveBeenCalled();
  });

  it("blocks client editors", async () => {
    const caller = tagsRouter.createCaller(
      makeContext({
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
            email: "client@example.com",
            name: "Client",
            role: "super_admin",
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        organizationRole: "client_editor",
      }),
    );

    await expect(
      caller.updateTags({ slug: "site-1", tags: ["marketing"] }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(setTagsMock).not.toHaveBeenCalled();
  });
});
