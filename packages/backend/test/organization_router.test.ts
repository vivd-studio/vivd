import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUserMock,
  findOrganizationMock,
  findOrganizationMemberMock,
  selectMock,
  selectFromMock,
  selectInnerJoinMock,
  selectWhereMock,
  selectOrderByMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  getTenantHostsForOrganizationsMock,
  inferTenantBaseDomainFromHostMock,
  ensureManagedTenantDomainForOrganizationMock,
} = vi.hoisted(() => {
  const selectOrderByMock = vi.fn();
  const selectWhereMock = vi.fn(() => ({ orderBy: selectOrderByMock }));
  const selectInnerJoinMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectFromMock = vi.fn(() => ({ innerJoin: selectInnerJoinMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    findUserMock: vi.fn(),
    findOrganizationMock: vi.fn(),
    findOrganizationMemberMock: vi.fn(),
    selectMock,
    selectFromMock,
    selectInnerJoinMock,
    selectWhereMock,
    selectOrderByMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    getTenantHostsForOrganizationsMock: vi.fn(),
    inferTenantBaseDomainFromHostMock: vi.fn(),
    ensureManagedTenantDomainForOrganizationMock: vi.fn(),
  };
});

vi.mock("../src/db", () => ({
  db: {
    query: {
      user: { findFirst: findUserMock },
      organization: { findFirst: findOrganizationMock },
      organizationMember: {
        findFirst: findOrganizationMemberMock,
      },
    },
    select: selectMock,
    update: updateMock,
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../src/services/publish/DomainService", () => ({
  domainService: {
    getTenantHostsForOrganizations: getTenantHostsForOrganizationsMock,
    inferTenantBaseDomainFromHost: inferTenantBaseDomainFromHostMock,
    ensureManagedTenantDomainForOrganization: ensureManagedTenantDomainForOrganizationMock,
  },
}));

vi.mock("../src/auth", () => ({
  auth: {
    api: {
      createUser: vi.fn(),
      setUserPassword: vi.fn(),
    },
  },
}));

import { organizationRouter } from "../src/routers/organization";

type UserRole = "super_admin" | "admin" | "user" | "client_editor";

function makeContext(
  overrides: Record<string, unknown> = {},
  opts: { userRole?: UserRole } = {},
) {
  const userRole = opts.userRole ?? "admin";
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
        role: userRole,
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

describe("organization router", () => {
  beforeEach(() => {
    findUserMock.mockReset();
    findOrganizationMock.mockReset();
    findOrganizationMemberMock.mockReset();
    selectMock.mockReset();
    selectFromMock.mockReset();
    selectInnerJoinMock.mockReset();
    selectWhereMock.mockReset();
    selectOrderByMock.mockReset();
    updateMock.mockReset();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    getTenantHostsForOrganizationsMock.mockReset();
    inferTenantBaseDomainFromHostMock.mockReset();
    ensureManagedTenantDomainForOrganizationMock.mockReset();

    selectWhereMock.mockImplementation(() => ({ orderBy: selectOrderByMock }));
    selectInnerJoinMock.mockImplementation(() => ({ where: selectWhereMock }));
    selectFromMock.mockImplementation(() => ({ innerJoin: selectInnerJoinMock }));
    selectMock.mockImplementation(() => ({ from: selectFromMock }));

    updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
    updateMock.mockImplementation(() => ({ set: updateSetMock }));

    findOrganizationMock.mockResolvedValue({
      id: "org-2",
      slug: "tenant-two",
      status: "active",
    });
    findOrganizationMemberMock.mockResolvedValue({ id: "member-1" });
    updateWhereMock.mockResolvedValue(undefined);
    inferTenantBaseDomainFromHostMock.mockReturnValue("localhost");
    getTenantHostsForOrganizationsMock.mockImplementation(async (organizationIds: string[]) => {
      return new Map(organizationIds.map((id) => [id, `${id}.localhost`]));
    });
    ensureManagedTenantDomainForOrganizationMock.mockResolvedValue(undefined);
  });

  it("lists organizations with tenant host mapping and active marker", async () => {
    const createdAtOne = new Date("2026-01-10T10:00:00.000Z");
    const createdAtTwo = new Date("2026-01-11T10:00:00.000Z");
    selectOrderByMock.mockResolvedValueOnce([
      {
        id: "org-1",
        slug: "tenant-one",
        name: "Tenant One",
        status: "active",
        role: "member",
        createdAt: createdAtOne,
      },
      {
        id: "org-2",
        slug: "tenant-two",
        name: "Tenant Two",
        status: "active",
        role: "owner",
        createdAt: createdAtTwo,
      },
    ]);
    getTenantHostsForOrganizationsMock.mockResolvedValueOnce(
      new Map([
        ["org-1", "tenant-one.localhost"],
        ["org-2", "tenant-two.localhost"],
      ]),
    );
    const caller = organizationRouter.createCaller(makeContext({ organizationId: "org-2" }));

    const result = await caller.listMyOrganizations();

    expect(getTenantHostsForOrganizationsMock).toHaveBeenCalledWith(["org-1", "org-2"], {
      preferredTenantBaseDomain: "localhost",
    });
    expect(result).toEqual({
      organizations: [
        expect.objectContaining({
          id: "org-1",
          tenantHost: "tenant-one.localhost",
          isActive: false,
          createdAt: createdAtOne,
        }),
        expect.objectContaining({
          id: "org-2",
          tenantHost: "tenant-two.localhost",
          isActive: true,
          createdAt: createdAtTwo,
        }),
      ],
    });
  });

  it("rejects active-organization selection when domain pins org context", async () => {
    const caller = organizationRouter.createCaller(
      makeContext({ canSelectOrganization: false }),
    );

    await expect(
      caller.setActiveOrganization({ organizationId: "org-2" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Organization selection is pinned to this domain",
    });
    expect(findOrganizationMock).not.toHaveBeenCalled();
  });

  it("rejects selecting a suspended organization for non-super-admins", async () => {
    findOrganizationMock.mockResolvedValueOnce({
      id: "org-2",
      slug: "tenant-two",
      status: "suspended",
    });
    const caller = organizationRouter.createCaller(
      makeContext({}, { userRole: "user" }),
    );

    await expect(
      caller.setActiveOrganization({ organizationId: "org-2" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Organization is suspended",
    });
    expect(ensureManagedTenantDomainForOrganizationMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects selection when the caller is not a member", async () => {
    findOrganizationMemberMock.mockResolvedValueOnce(null);
    const caller = organizationRouter.createCaller(
      makeContext({}, { userRole: "user" }),
    );

    await expect(
      caller.setActiveOrganization({ organizationId: "org-2" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "You are not a member of this organization",
    });
    expect(ensureManagedTenantDomainForOrganizationMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("allows super-admin selection and persists active org even when suspended", async () => {
    findOrganizationMock.mockResolvedValueOnce({
      id: "org-2",
      slug: "tenant-two",
      status: "suspended",
    });
    getTenantHostsForOrganizationsMock.mockResolvedValueOnce(
      new Map([["org-2", "tenant-two.localhost"]]),
    );
    const caller = organizationRouter.createCaller(
      makeContext({}, { userRole: "super_admin" }),
    );

    const result = await caller.setActiveOrganization({ organizationId: "org-2" });

    expect(findOrganizationMemberMock).not.toHaveBeenCalled();
    expect(ensureManagedTenantDomainForOrganizationMock).toHaveBeenCalledWith({
      organizationId: "org-2",
      organizationSlug: "tenant-two",
    });
    expect(updateSetMock).toHaveBeenCalledWith({ activeOrganizationId: "org-2" });
    expect(result).toEqual({ success: true, tenantHost: "tenant-two.localhost" });
  });
});
