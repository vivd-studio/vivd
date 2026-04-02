import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureAnalyticsPluginMock,
  updateAnalyticsConfigMock,
  getAnalyticsSummaryMock,
} = vi.hoisted(() => ({
  ensureAnalyticsPluginMock: vi.fn(),
  updateAnalyticsConfigMock: vi.fn(),
  getAnalyticsSummaryMock: vi.fn(),
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

vi.mock("../src/services/plugins/ProjectPluginService", () => ({
  projectPluginService: {
    ensureAnalyticsPlugin: ensureAnalyticsPluginMock,
    updateAnalyticsConfig: updateAnalyticsConfigMock,
    getAnalyticsSummary: getAnalyticsSummaryMock,
  },
}));

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    resolveEffectiveEntitlement: resolveEffectiveEntitlementMock,
  },
}));

import { router } from "../src/trpc";
import {
  analyticsEnsurePluginProcedure,
  analyticsSummaryPluginProcedure,
  analyticsUpdateConfigPluginProcedure,
} from "../src/trpcRouters/plugins/analytics";

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
    ensureAnalyticsPluginMock.mockReset();
    updateAnalyticsConfigMock.mockReset();
    getAnalyticsSummaryMock.mockReset();
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
    expect(ensureAnalyticsPluginMock).not.toHaveBeenCalled();
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
    expect(ensureAnalyticsPluginMock).not.toHaveBeenCalled();
  });

  it("allows super-admin users to enable analytics", async () => {
    ensureAnalyticsPluginMock.mockResolvedValueOnce({
      pluginId: "analytics",
      instanceId: "ppi-1",
      status: "enabled",
      created: true,
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

    expect(ensureAnalyticsPluginMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
    });
  });

  it("maps disabled-plugin config updates to UNAUTHORIZED", async () => {
    updateAnalyticsConfigMock.mockRejectedValueOnce(
      new Error(
        "Analytics plugin is not enabled for this project. Ask a super-admin to enable it first.",
      ),
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
    getAnalyticsSummaryMock.mockResolvedValueOnce({
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

    expect(getAnalyticsSummaryMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      rangeDays: 7,
    });
  });
});
