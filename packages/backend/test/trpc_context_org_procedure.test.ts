import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  resolveHostMock,
  sessionFindFirstMock,
  organizationMemberFindManyMock,
  organizationFindFirstMock,
  projectMemberFindFirstMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => {
  const getSessionMock = vi.fn();
  const resolveHostMock = vi.fn();
  const sessionFindFirstMock = vi.fn();
  const organizationMemberFindManyMock = vi.fn();
  const organizationFindFirstMock = vi.fn();
  const projectMemberFindFirstMock = vi.fn();
  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  return {
    getSessionMock,
    resolveHostMock,
    sessionFindFirstMock,
    organizationMemberFindManyMock,
    organizationFindFirstMock,
    projectMemberFindFirstMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
  };
});

vi.mock("../src/lib/authProvider", () => ({
  getSession: getSessionMock,
}));

vi.mock("../src/services/publish/DomainService", () => ({
  domainService: {
    resolveHost: resolveHostMock,
  },
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      session: { findFirst: sessionFindFirstMock },
      organizationMember: { findMany: organizationMemberFindManyMock },
      organization: { findFirst: organizationFindFirstMock },
      projectMember: { findFirst: projectMemberFindFirstMock },
    },
    update: updateMock,
  },
}));

import { createContext, orgProcedure, router } from "../src/trpc";

function makeRequest(headers: Record<string, string> = {}): any {
  return {
    headers: {
      host: "app.vivd.local",
      ...headers,
    },
  };
}

function makeBaseResolvedHost(overrides: Record<string, unknown> = {}) {
  return {
    requestHost: "app.vivd.local",
    requestDomain: "app.vivd.local",
    hostKind: "control_plane_host",
    hostOrganizationId: null,
    hostOrganizationSlug: null,
    isSuperAdminHost: false,
    canSelectOrganization: true,
    ...overrides,
  };
}

function makeBaseSession(overrides: Record<string, unknown> = {}) {
  return {
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
      email: "user@example.com",
      name: "User",
      role: "user",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  };
}

function makeBaseProcedureContext(overrides: Record<string, unknown> = {}) {
  return {
    req: {} as any,
    res: {} as any,
    session: null,
    requestHost: "app.vivd.local",
    requestDomain: "app.vivd.local",
    isSuperAdminHost: false,
    hostKind: "control_plane_host",
    hostOrganizationId: null,
    hostOrganizationSlug: null,
    canSelectOrganization: true,
    organizationId: null,
    organizationRole: null,
    ...overrides,
  };
}

describe("createContext", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    resolveHostMock.mockReset();
    sessionFindFirstMock.mockReset();
    organizationMemberFindManyMock.mockReset();
    organizationFindFirstMock.mockReset();
    projectMemberFindFirstMock.mockReset();
    updateMock.mockClear();
    updateSetMock.mockClear();
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);

    getSessionMock.mockResolvedValue(null);
    resolveHostMock.mockResolvedValue(makeBaseResolvedHost());
    sessionFindFirstMock.mockResolvedValue(null);
    organizationMemberFindManyMock.mockResolvedValue([]);
    organizationFindFirstMock.mockResolvedValue({ status: "active" });
    projectMemberFindFirstMock.mockResolvedValue(null);
  });

  it("prefers host-pinned organization over session and request header", async () => {
    getSessionMock.mockResolvedValue(makeBaseSession());
    resolveHostMock.mockResolvedValue(
      makeBaseResolvedHost({
        hostKind: "tenant_host",
        canSelectOrganization: false,
        hostOrganizationId: "org-host",
        hostOrganizationSlug: "org-host",
      }),
    );
    sessionFindFirstMock.mockResolvedValue({
      id: "sess-1",
      activeOrganizationId: "org-session",
    });
    organizationMemberFindManyMock.mockResolvedValue([
      { organizationId: "org-host", role: "admin" },
      { organizationId: "org-session", role: "member" },
    ]);

    const ctx = await createContext({
      req: makeRequest({ "x-vivd-organization-id": "org-request" }),
      res: {} as any,
    });

    expect(ctx.organizationId).toBe("org-host");
    expect(ctx.hostOrganizationId).toBe("org-host");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("falls back to bearer-token session membership on unknown hosts", async () => {
    const nowIso = new Date().toISOString();
    getSessionMock.mockResolvedValue(null);
    resolveHostMock.mockResolvedValue(
      makeBaseResolvedHost({
        hostKind: "unknown",
        canSelectOrganization: false,
      }),
    );
    sessionFindFirstMock.mockResolvedValue({
      id: "sess-2",
      token: "token-1",
      userId: "user-2",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: nowIso,
      updatedAt: nowIso,
      ipAddress: null,
      userAgent: null,
      activeOrganizationId: "org-stale",
      user: {
        id: "user-2",
        email: "user2@example.com",
        name: "User 2",
        role: "user",
        emailVerified: true,
        image: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
    organizationMemberFindManyMock.mockResolvedValue([
      { organizationId: "default", role: "member" },
      { organizationId: "org-live", role: "admin" },
    ]);

    const ctx = await createContext({
      req: makeRequest({ authorization: "Bearer token-1" }),
      res: {} as any,
    });

    expect(ctx.organizationId).toBe("org-live");
    expect(ctx.organizationRole).toBe("admin");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("ignores requested organization header when user is not a member", async () => {
    getSessionMock.mockResolvedValue(makeBaseSession());
    resolveHostMock.mockResolvedValue(makeBaseResolvedHost());
    sessionFindFirstMock.mockResolvedValue({
      id: "sess-1",
      activeOrganizationId: "org-member",
    });
    organizationMemberFindManyMock.mockResolvedValue([
      { organizationId: "org-member", role: "member" },
    ]);

    const ctx = await createContext({
      req: makeRequest({ "x-vivd-organization-id": "org-other" }),
      res: {} as any,
    });

    expect(ctx.organizationId).toBe("org-member");
  });
});

describe("orgProcedure", () => {
  const testRouter = router({
    ping: orgProcedure.query(() => "ok"),
  });

  beforeEach(() => {
    organizationFindFirstMock.mockReset();
    organizationFindFirstMock.mockResolvedValue({ status: "active" });
  });

  it("rejects unauthenticated calls", async () => {
    const caller = testRouter.createCaller(makeBaseProcedureContext());
    await expect(caller.ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects when no organization is selected", async () => {
    const caller = testRouter.createCaller(
      makeBaseProcedureContext({
        session: makeBaseSession(),
      }),
    );
    await expect(caller.ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "No organization selected",
    });
  });

  it("rejects suspended organizations for non-super-admin users", async () => {
    organizationFindFirstMock.mockResolvedValueOnce({ status: "suspended" });
    const caller = testRouter.createCaller(
      makeBaseProcedureContext({
        session: makeBaseSession(),
        organizationId: "org-1",
        organizationRole: "member",
      }),
    );

    await expect(caller.ping()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Organization is suspended",
    });
  });

  it("allows super-admin users", async () => {
    const caller = testRouter.createCaller(
      makeBaseProcedureContext({
        session: makeBaseSession({
          user: {
            ...makeBaseSession().user,
            role: "super_admin",
          },
        }),
        organizationId: "org-1",
      }),
    );

    await expect(caller.ping()).resolves.toBe("ok");
    expect(organizationFindFirstMock).not.toHaveBeenCalled();
  });
});
