import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getManifestMock,
  setTagsMock,
  removeTagFromOrganizationMock,
  listOrganizationTagsMock,
  renameTagInOrganizationMock,
  setTagColorMock,
} = vi.hoisted(() => ({
  getManifestMock: vi.fn(),
  setTagsMock: vi.fn(),
  removeTagFromOrganizationMock: vi.fn(),
  listOrganizationTagsMock: vi.fn(),
  renameTagInOrganizationMock: vi.fn(),
  setTagColorMock: vi.fn(),
}));

vi.mock("../src/generator/versionUtils", () => ({
  getManifest: getManifestMock,
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    setTags: setTagsMock,
    removeTagFromOrganization: removeTagFromOrganizationMock,
    listOrganizationTags: listOrganizationTagsMock,
    renameTagInOrganization: renameTagInOrganizationMock,
    setTagColor: setTagColorMock,
  },
}));

import { router } from "../src/trpc";
import { projectTagProcedures } from "../src/trpcRouters/project/tags";

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
    listTags: projectTagProcedures.listTags,
    updateTags: projectTagProcedures.updateTags,
    renameTag: projectTagProcedures.renameTag,
    deleteTag: projectTagProcedures.deleteTag,
    setTagColor: projectTagProcedures.setTagColor,
  });

  beforeEach(() => {
    getManifestMock.mockReset();
    setTagsMock.mockReset();
    removeTagFromOrganizationMock.mockReset();
    listOrganizationTagsMock.mockReset();
    renameTagInOrganizationMock.mockReset();
    setTagColorMock.mockReset();
    getManifestMock.mockResolvedValue({
      url: "https://example.com",
      tags: [],
      versions: [],
      createdAt: new Date().toISOString(),
      currentVersion: 1,
      publicPreviewEnabled: true,
    });
    setTagsMock.mockResolvedValue(undefined);
    removeTagFromOrganizationMock.mockResolvedValue({
      updatedSlugs: ["site-1"],
    });
    listOrganizationTagsMock.mockResolvedValue([
      { tag: "marketing", colorId: null },
      { tag: "seo", colorId: "blue" },
    ]);
    renameTagInOrganizationMock.mockResolvedValue({
      updatedSlugs: ["site-1"],
    });
    setTagColorMock.mockResolvedValue(undefined);
  });

  it("lists organization tags from the shared tag entity", async () => {
    const caller = tagsRouter.createCaller(makeContext());

    await expect(caller.listTags()).resolves.toEqual({
      tags: [
        { tag: "marketing", colorId: null },
        { tag: "seo", colorId: "blue" },
      ],
    });

    expect(listOrganizationTagsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
    });
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

  it("deletes a label across all projects in the organization", async () => {
    removeTagFromOrganizationMock.mockResolvedValueOnce({
      updatedSlugs: ["site-1", "site-2"],
    });
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.deleteTag({ tag: " #Marketing " }),
    ).resolves.toEqual({
      success: true,
      tag: "marketing",
      updatedProjects: 2,
    });

    expect(removeTagFromOrganizationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      tag: "marketing",
    });
  });

  it("renames a label across all projects in the organization", async () => {
    renameTagInOrganizationMock.mockResolvedValueOnce({
      updatedSlugs: ["site-1", "site-2"],
    });
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.renameTag({ fromTag: " #Marketing ", toTag: "Branding" }),
    ).resolves.toEqual({
      success: true,
      fromTag: "marketing",
      toTag: "branding",
      updatedProjects: 2,
    });

    expect(renameTagInOrganizationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      fromTag: "marketing",
      toTag: "branding",
    });
  });

  it("returns BAD_REQUEST when renaming with an empty tag", async () => {
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.renameTag({ fromTag: "marketing", toTag: "   " }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Tags cannot be empty.",
    });
    expect(renameTagInOrganizationMock).not.toHaveBeenCalled();
  });

  it("stores shared tag colors", async () => {
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.setTagColor({ tag: " #SEO ", colorId: "emerald" }),
    ).resolves.toEqual({
      success: true,
      tag: "seo",
      colorId: "emerald",
    });

    expect(setTagColorMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      tag: "seo",
      colorId: "emerald",
    });
  });

  it("returns BAD_REQUEST when deleting an empty label", async () => {
    const caller = tagsRouter.createCaller(makeContext());

    await expect(
      caller.deleteTag({ tag: "   " }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Tag cannot be empty.",
    });
    expect(removeTagFromOrganizationMock).not.toHaveBeenCalled();
  });

});
