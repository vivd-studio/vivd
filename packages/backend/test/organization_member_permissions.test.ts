import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findOrganizationMock,
  findOrganizationMemberMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  deleteMock,
  deleteWhereMock,
  authSetUserPasswordMock,
  authCreateUserMock,
} = vi.hoisted(() => {
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));
  const deleteWhereMock = vi.fn();
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  return {
    findOrganizationMock: vi.fn(),
    findOrganizationMemberMock: vi.fn(),
    updateMock,
    updateSetMock,
    updateWhereMock,
    deleteMock,
    deleteWhereMock,
    authSetUserPasswordMock: vi.fn(),
    authCreateUserMock: vi.fn(),
  };
});

vi.mock("../src/db", () => ({
  db: {
    query: {
      organization: { findFirst: findOrganizationMock },
      organizationMember: { findFirst: findOrganizationMemberMock },
    },
    update: updateMock,
    delete: deleteMock,
    insert: vi.fn(),
  },
}));

vi.mock("../src/auth", () => ({
  auth: {
    api: {
      createUser: authCreateUserMock,
      setUserPassword: authSetUserPasswordMock,
    },
  },
}));

import { router } from "../src/trpc";
import { organizationMembershipProcedures } from "../src/trpcRouters/organization/members";

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
        name: "Org Admin",
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
    organizationRole: "admin",
    ...overrides,
  };
}

describe("organization member management permissions", () => {
  const membersRouter = router({
    updateMemberRole: organizationMembershipProcedures.updateMemberRole,
    resetMemberPassword: organizationMembershipProcedures.resetMemberPassword,
    removeMember: organizationMembershipProcedures.removeMember,
  });

  beforeEach(() => {
    findOrganizationMock.mockReset();
    findOrganizationMemberMock.mockReset();
    updateMock.mockReset();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    deleteMock.mockReset();
    deleteWhereMock.mockReset();
    authSetUserPasswordMock.mockReset();
    authCreateUserMock.mockReset();

    findOrganizationMock.mockResolvedValue({
      id: "org-1",
      status: "active",
    });
    updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
    updateMock.mockImplementation(() => ({ set: updateSetMock }));
    updateWhereMock.mockResolvedValue(undefined);
    deleteMock.mockImplementation(() => ({ where: deleteWhereMock }));
    deleteWhereMock.mockResolvedValue(undefined);
  });

  it("blocks org admins from changing a platform super-admin's organization role", async () => {
    findOrganizationMemberMock.mockResolvedValueOnce({
      role: "member",
      user: { role: "super_admin" },
    });
    const caller = membersRouter.createCaller(makeContext());

    await expect(
      caller.updateMemberRole({ userId: "user-2", role: "member" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Super-admin accounts can only be managed by super-admins",
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("blocks org admins from resetting a platform super-admin password", async () => {
    findOrganizationMemberMock.mockResolvedValueOnce({
      role: "member",
      user: { role: "super_admin" },
    });
    const caller = membersRouter.createCaller(makeContext());

    await expect(
      caller.resetMemberPassword({
        userId: "user-2",
        newPassword: "super-secret-password",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Super-admin accounts can only be managed by super-admins",
    });

    expect(authSetUserPasswordMock).not.toHaveBeenCalled();
  });

  it("blocks org admins from removing a platform super-admin membership", async () => {
    findOrganizationMemberMock.mockResolvedValueOnce({
      role: "member",
      user: { role: "super_admin" },
    });
    const caller = membersRouter.createCaller(makeContext());

    await expect(
      caller.removeMember({ userId: "user-2" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Super-admin accounts can only be managed by super-admins",
    });

    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("keeps organization role changes tenant-scoped for normal members", async () => {
    findOrganizationMemberMock.mockResolvedValueOnce({
      role: "member",
      user: { role: "user" },
    });
    const caller = membersRouter.createCaller(makeContext());

    await expect(
      caller.updateMemberRole({ userId: "user-2", role: "admin" }),
    ).resolves.toEqual({ success: true });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
