import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureProjectPluginInstanceMock,
  getProjectPluginInfoMock,
  readProjectPluginDataMock,
  updateProjectPluginConfigMock,
} = vi.hoisted(() => ({
  ensureProjectPluginInstanceMock: vi.fn(),
  getProjectPluginInfoMock: vi.fn(),
  readProjectPluginDataMock: vi.fn(),
  updateProjectPluginConfigMock: vi.fn(),
}));

const { resolveEffectiveEntitlementMock } = vi.hoisted(() => ({
  resolveEffectiveEntitlementMock: vi.fn(),
}));

const { organizationFindFirstMock, selectMock, selectFromMock, selectWhereMock } = vi.hoisted(
  () => {
    const selectWhereMock = vi.fn().mockResolvedValue([]);
    const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
    const selectMock = vi.fn(() => ({ from: selectFromMock }));
    return {
      organizationFindFirstMock: vi.fn(),
      selectMock,
      selectFromMock,
      selectWhereMock,
    };
  },
);

vi.mock("../src/db", () => ({
  db: {
    select: selectMock,
    query: {
      organization: {
        findFirst: organizationFindFirstMock,
      },
    },
  },
}));

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    resolveEffectiveEntitlement: resolveEffectiveEntitlementMock,
  },
}));

vi.mock("../src/trpcRouters/plugins/operations", () => ({
  ensureProjectPluginInstance: ensureProjectPluginInstanceMock,
  getProjectPluginInfo: getProjectPluginInfoMock,
  readProjectPluginData: readProjectPluginDataMock,
  updateProjectPluginConfig: updateProjectPluginConfigMock,
  runProjectPluginAction: vi.fn(),
  extractRequestHost: vi.fn(() => "app.vivd.local"),
}));

import { router } from "../src/trpc";
import {
  analyticsEnsurePluginProcedure,
  analyticsSummaryPluginProcedure,
  analyticsUpdateConfigPluginProcedure,
} from "../src/trpcRouters/plugins/analytics";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: { headers: {} } as any,
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
        email: "user@example.com",
        name: "User",
        role: "user",
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

describe("plugins.analytics router behavior", () => {
  const pluginsRouter = router({
    analyticsEnsure: analyticsEnsurePluginProcedure,
    analyticsUpdateConfig: analyticsUpdateConfigPluginProcedure,
    analyticsSummary: analyticsSummaryPluginProcedure,
  });

  beforeEach(() => {
    ensureProjectPluginInstanceMock.mockReset();
    getProjectPluginInfoMock.mockReset();
    readProjectPluginDataMock.mockReset();
    updateProjectPluginConfigMock.mockReset();
    resolveEffectiveEntitlementMock.mockReset();
    organizationFindFirstMock.mockReset();
    selectMock.mockClear();
    selectFromMock.mockClear();
    selectWhereMock.mockReset();

    organizationFindFirstMock.mockResolvedValue({ status: "active" });
    selectWhereMock.mockResolvedValue([]);
    resolveEffectiveEntitlementMock.mockResolvedValue({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
      scope: "project",
      state: "enabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: true,
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
      notes: "",
      changedByUserId: null,
      updatedAt: new Date(),
    });
  });

  it("rejects non-super-admin users when enabling analytics", async () => {
    const caller = pluginsRouter.createCaller(makeContext());

    await expect(caller.analyticsEnsure({ slug: "site-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Only super-admin users can enable plugins",
    });
    expect(ensureProjectPluginInstanceMock).not.toHaveBeenCalled();
  });

  it("rejects analytics enable when entitlement is disabled", async () => {
    resolveEffectiveEntitlementMock.mockResolvedValueOnce({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
      scope: "project",
      state: "disabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: true,
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
      notes: "",
      changedByUserId: null,
      updatedAt: new Date(),
    });

    const caller = pluginsRouter.createCaller(
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
            email: "sa@example.com",
            name: "Super Admin",
            role: "super_admin",
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        organizationRole: null,
      }),
    );

    await expect(caller.analyticsEnsure({ slug: "site-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Analytics is not entitled for this project",
    });
    expect(ensureProjectPluginInstanceMock).not.toHaveBeenCalled();
  });

  it("allows super-admin users to enable analytics", async () => {
    ensureProjectPluginInstanceMock.mockResolvedValueOnce({
      instanceId: "ppi-1",
      created: true,
      status: "enabled",
    });
    getProjectPluginInfoMock.mockResolvedValueOnce({
      pluginId: "analytics",
      entitled: true,
      entitlementState: "enabled",
      enabled: true,
      instanceId: "ppi-1",
      status: "enabled",
      publicToken: "analytics.token",
      config: {
        respectDoNotTrack: true,
        captureQueryString: false,
        excludedPaths: [],
        enableClientTracking: true,
      },
      snippets: {
        html: "<script></script>",
        astro: "<script></script>",
      },
      usage: null,
      details: null,
      instructions: [],
      defaultConfig: {},
      catalog: {
        pluginId: "analytics",
        name: "Analytics",
        description: "",
        capabilities: {
          supportsInfo: true,
          config: null,
          actions: [],
        },
      },
    });

    const caller = pluginsRouter.createCaller(
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
            email: "sa@example.com",
            name: "Super Admin",
            role: "super_admin",
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        organizationRole: null,
      }),
    );

    await expect(caller.analyticsEnsure({ slug: "site-1" })).resolves.toMatchObject({
      pluginId: "analytics",
      instanceId: "ppi-1",
      created: true,
    });

    expect(ensureProjectPluginInstanceMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
    });
    expect(getProjectPluginInfoMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
    });
  });

  it("maps disabled-plugin config updates to UNAUTHORIZED", async () => {
    updateProjectPluginConfigMock.mockRejectedValueOnce(
      new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "Analytics plugin is not enabled for this project. Ask a super-admin to enable it first.",
      }),
    );

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.analyticsUpdateConfig({
        slug: "site-1",
        config: {
          respectDoNotTrack: true,
          captureQueryString: false,
          excludedPaths: [],
          enableClientTracking: true,
        },
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message:
        "Analytics plugin is not enabled for this project. Ask a super-admin to enable it first.",
    });
  });

  it("returns analytics summary for project members", async () => {
    readProjectPluginDataMock.mockResolvedValueOnce({
      pluginId: "analytics",
      readId: "summary",
      result: {
        pluginId: "analytics",
        enabled: true,
        rangeDays: 7,
        rangeStart: "2026-02-16",
        rangeEnd: "2026-02-22",
        totals: {
          events: 120,
          pageviews: 104,
          uniqueVisitors: 52,
          uniqueSessions: 64,
          avgPagesPerSession: 1.63,
        },
        daily: [],
        topPages: [],
        topReferrers: [],
        devices: [],
      },
    });

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.analyticsSummary({
        slug: "site-1",
        rangeDays: 7,
      }),
    ).resolves.toMatchObject({
      pluginId: "analytics",
      enabled: true,
      rangeDays: 7,
    });

    expect(readProjectPluginDataMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
      readId: "summary",
      input: {
        rangeDays: 7,
      },
    });
  });
});
