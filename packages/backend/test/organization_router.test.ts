import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolvePolicyMock,
  findUserMock,
  findOrganizationMock,
  findOrganizationMemberMock,
  findProjectMetaManyMock,
  findProjectPluginInstanceManyMock,
  findPluginEntitlementManyMock,
  findPublishedSiteManyMock,
  selectMock,
  selectFromMock,
  selectInnerJoinMock,
  selectWhereMock,
  selectOrderByMock,
  selectGroupByMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  invitationServiceInviteMemberMock,
  invitationServiceListInvitationsMock,
  invitationServiceGetPublicInviteMock,
  invitationServiceAcceptInviteWithSignupMock,
  invitationServiceAcceptInviteForUserMock,
  getOrganizationInvitationStorageErrorMessageMock,
  rateLimitCheckActionMock,
  getTenantHostsForOrganizationsMock,
  inferTenantBaseDomainFromHostMock,
  ensureManagedTenantDomainForOrganizationMock,
} = vi.hoisted(() => {
  const resolvePolicyMock = vi.fn();
  const selectOrderByMock = vi.fn();
  const selectGroupByMock = vi.fn();
  const selectWhereMock = vi.fn(() => ({
    orderBy: selectOrderByMock,
    groupBy: selectGroupByMock,
  }));
  const selectInnerJoinMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectFromMock = vi.fn(() => ({
    innerJoin: selectInnerJoinMock,
    where: selectWhereMock,
  }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    resolvePolicyMock,
    findUserMock: vi.fn(),
    findOrganizationMock: vi.fn(),
    findOrganizationMemberMock: vi.fn(),
    findProjectMetaManyMock: vi.fn(),
    findProjectPluginInstanceManyMock: vi.fn(),
    findPluginEntitlementManyMock: vi.fn(),
    findPublishedSiteManyMock: vi.fn(),
    selectMock,
    selectFromMock,
    selectInnerJoinMock,
    selectWhereMock,
    selectOrderByMock,
    selectGroupByMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    invitationServiceInviteMemberMock: vi.fn(),
    invitationServiceListInvitationsMock: vi.fn(),
    invitationServiceGetPublicInviteMock: vi.fn(),
    invitationServiceAcceptInviteWithSignupMock: vi.fn(),
    invitationServiceAcceptInviteForUserMock: vi.fn(),
    getOrganizationInvitationStorageErrorMessageMock: vi.fn(),
    rateLimitCheckActionMock: vi.fn(),
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
      projectMeta: { findMany: findProjectMetaManyMock },
      projectPluginInstance: { findMany: findProjectPluginInstanceManyMock },
      pluginEntitlement: { findMany: findPluginEntitlementManyMock },
      publishedSite: { findMany: findPublishedSiteManyMock },
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

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    resolvePolicy: resolvePolicyMock,
  },
}));

vi.mock("../src/services/auth/OrganizationInvitationService", () => ({
  getOrganizationInvitationStorageErrorMessage:
    getOrganizationInvitationStorageErrorMessageMock,
  organizationInvitationService: {
    inviteMember: invitationServiceInviteMemberMock,
    listOrganizationInvitations: invitationServiceListInvitationsMock,
    getPublicInvite: invitationServiceGetPublicInviteMock,
    acceptInviteWithSignup: invitationServiceAcceptInviteWithSignupMock,
    acceptInviteForUser: invitationServiceAcceptInviteForUserMock,
    resendInvite: vi.fn(),
    cancelInvite: vi.fn(),
  },
}));

vi.mock("../src/services/system/ControlPlaneRateLimitService", () => ({
  controlPlaneRateLimitService: {
    checkAction: rateLimitCheckActionMock,
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

import { organizationRouter } from "../src/trpcRouters/organization";

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
    findProjectMetaManyMock.mockReset();
    findProjectPluginInstanceManyMock.mockReset();
    findPluginEntitlementManyMock.mockReset();
    findPublishedSiteManyMock.mockReset();
    selectMock.mockReset();
    selectFromMock.mockReset();
    selectInnerJoinMock.mockReset();
    selectWhereMock.mockReset();
    selectOrderByMock.mockReset();
    selectGroupByMock.mockReset();
    updateMock.mockReset();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    invitationServiceInviteMemberMock.mockReset();
    invitationServiceListInvitationsMock.mockReset();
    invitationServiceGetPublicInviteMock.mockReset();
    invitationServiceAcceptInviteWithSignupMock.mockReset();
    invitationServiceAcceptInviteForUserMock.mockReset();
    getOrganizationInvitationStorageErrorMessageMock.mockReset();
    rateLimitCheckActionMock.mockReset();
    getTenantHostsForOrganizationsMock.mockReset();
    inferTenantBaseDomainFromHostMock.mockReset();
    ensureManagedTenantDomainForOrganizationMock.mockReset();
    resolvePolicyMock.mockReset();

    selectWhereMock.mockImplementation(() => ({
      orderBy: selectOrderByMock,
      groupBy: selectGroupByMock,
    }));
    selectInnerJoinMock.mockImplementation(() => ({ where: selectWhereMock }));
    selectFromMock.mockImplementation(() => ({
      innerJoin: selectInnerJoinMock,
      where: selectWhereMock,
    }));
    selectMock.mockImplementation(() => ({ from: selectFromMock }));

    updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
    updateMock.mockImplementation(() => ({ set: updateSetMock }));

    getOrganizationInvitationStorageErrorMessageMock.mockReturnValue(null);
    rateLimitCheckActionMock.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    findProjectMetaManyMock.mockResolvedValue([]);
    findProjectPluginInstanceManyMock.mockResolvedValue([]);
    findPluginEntitlementManyMock.mockResolvedValue([]);
    findPublishedSiteManyMock.mockResolvedValue([]);
    selectGroupByMock.mockResolvedValue([]);
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
      pluginDefaults: {
        contact_form: {
          pluginId: "contact_form",
          state: "disabled",
          managedBy: "manual_superadmin",
        },
        analytics: {
          pluginId: "analytics",
          state: "disabled",
          managedBy: "manual_superadmin",
        },
      },
      limitDefaults: {},
      controlPlane: { mode: "host_based" },
      pluginRuntime: { mode: "dedicated_host" },
    });

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

  it("rejects active-organization selection when multi-org is disabled", async () => {
    resolvePolicyMock.mockResolvedValueOnce({
      installProfile: "solo",
      singleProjectMode: true,
      capabilities: {
        multiOrg: false,
        tenantHosts: false,
        customDomains: false,
        orgLimitOverrides: false,
        orgPluginEntitlements: false,
        projectPluginEntitlements: false,
        dedicatedPluginHost: false,
      },
      pluginDefaults: {
        contact_form: {
          pluginId: "contact_form",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
        analytics: {
          pluginId: "analytics",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
      },
      limitDefaults: {},
      controlPlane: { mode: "path_based" },
      pluginRuntime: { mode: "same_host_path" },
    });
    const caller = organizationRouter.createCaller(makeContext());

    await expect(
      caller.setActiveOrganization({ organizationId: "org-2" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Organization switching is disabled for this install profile",
    });
    expect(findOrganizationMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
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

  it("accepts non-slug organization IDs when selecting active organization", async () => {
    findOrganizationMock.mockResolvedValueOnce({
      id: "Org_A2",
      slug: "tenant-two",
      status: "active",
    });
    getTenantHostsForOrganizationsMock.mockResolvedValueOnce(
      new Map([["Org_A2", "tenant-two.localhost"]]),
    );
    const caller = organizationRouter.createCaller(makeContext());

    const result = await caller.setActiveOrganization({ organizationId: " Org_A2 " });

    expect(findOrganizationMock).toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith({ activeOrganizationId: "Org_A2" });
    expect(result).toEqual({ success: true, tenantHost: "tenant-two.localhost" });
  });

  it("sends organization invites through the invitation service", async () => {
    invitationServiceInviteMemberMock.mockResolvedValueOnce({
      invitationId: "invite-1",
      deliveryAccepted: true,
    });
    const caller = organizationRouter.createCaller(
      makeContext({ requestIp: "127.0.0.1" }),
    );

    const result = await caller.inviteMember({
      email: "teammate@example.com",
      name: "Pat",
      role: "client_editor",
      projectSlug: "launch-site",
    });

    expect(rateLimitCheckActionMock).toHaveBeenCalledWith({
      action: "auth",
      organizationId: "org-1",
      requestIp: "127.0.0.1",
      userId: "user-1",
    });
    expect(invitationServiceInviteMemberMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      email: "teammate@example.com",
      inviteeName: "Pat",
      role: "client_editor",
      projectSlug: "launch-site",
      inviterId: "user-1",
    });
    expect(result).toEqual({
      invitationId: "invite-1",
      deliveryAccepted: true,
    });
  });

  it("returns an actionable message when invite storage is out of date", async () => {
    invitationServiceListInvitationsMock.mockRejectedValueOnce(
      new Error(
        'Failed query: select "organizationInvitation"."invitee_name" from "organization_invitation" "organizationInvitation" column "invitee_name" does not exist',
      ),
    );
    getOrganizationInvitationStorageErrorMessageMock.mockReturnValueOnce(
      "Organization invite storage is unavailable or out of date. Run backend db:migrate to apply migration 0029_organization_member_invites.sql.",
    );
    const caller = organizationRouter.createCaller(makeContext());

    await expect(caller.listInvitations()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Organization invite storage is unavailable or out of date. Run backend db:migrate to apply migration 0029_organization_member_invites.sql.",
    });
  });

  it("accepts invite signup through the public invitation flow", async () => {
    invitationServiceAcceptInviteWithSignupMock.mockResolvedValueOnce({
      email: "teammate@example.com",
      organizationId: "org-1",
      tenantHost: "tenant-one.localhost",
    });
    const caller = organizationRouter.createCaller(
      makeContext({
        session: null,
        organizationId: null,
        requestIp: "198.51.100.24",
      }),
    );

    const result = await caller.acceptInviteWithSignup({
      token: "invite-token",
      name: "Pat",
      password: "hunter22!",
    });

    expect(rateLimitCheckActionMock).toHaveBeenCalledWith({
      action: "auth",
      organizationId: null,
      requestIp: "198.51.100.24",
      userId: null,
    });
    expect(invitationServiceAcceptInviteWithSignupMock).toHaveBeenCalledWith({
      token: "invite-token",
      name: "Pat",
      password: "hunter22!",
    });
    expect(result).toEqual({
      email: "teammate@example.com",
      organizationId: "org-1",
      tenantHost: "tenant-one.localhost",
    });
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

  it("returns plugin overview with high-signal contact-form issues", async () => {
    findProjectMetaManyMock.mockResolvedValueOnce([
      {
        slug: "site-1",
        title: "Site One",
        updatedAt: new Date("2026-02-25T10:00:00.000Z"),
      },
    ]);
    findProjectPluginInstanceManyMock.mockResolvedValueOnce([
      {
        projectSlug: "site-1",
        pluginId: "contact_form",
        status: "enabled",
        configJson: {},
      },
    ]);
    selectGroupByMock.mockResolvedValueOnce([
      {
        projectSlug: "site-1",
        count: 2,
      },
    ]);
    findPluginEntitlementManyMock.mockResolvedValueOnce([
      {
        scope: "project",
        projectSlug: "site-1",
        state: "enabled",
        turnstileEnabled: true,
        turnstileSiteKey: null,
        turnstileSecretKey: null,
      },
    ]);
    findPublishedSiteManyMock.mockResolvedValueOnce([
      {
        projectSlug: "site-1",
        domain: "site-1.example.com",
        publishedAt: new Date("2026-02-25T11:00:00.000Z"),
      },
    ]);

    const caller = organizationRouter.createCaller(makeContext());

    const result = await caller.pluginsOverview();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      projectSlug: "site-1",
      projectTitle: "Site One",
      deployedDomain: "site-1.example.com",
    });
    expect(result.rows[0]?.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: "contact_form",
          installState: "enabled",
          summaryLines: expect.arrayContaining([
            "Recipients configured: 0",
            "Pending verification: 2",
          ]),
          badges: expect.arrayContaining([
            expect.objectContaining({
              label: "Turnstile syncing",
              tone: "destructive",
            }),
          ]),
        }),
        expect.objectContaining({
          pluginId: "analytics",
          installState: "disabled",
          instanceId: null,
        }),
      ]),
    );
    expect(result.rows[0]?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "contact_no_recipients",
        "contact_pending_recipients",
        "contact_turnstile_not_ready",
      ]),
    );
  });
});
