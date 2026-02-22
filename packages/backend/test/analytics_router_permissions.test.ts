import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateAnalyticsConfigMock, getAnalyticsSummaryMock } = vi.hoisted(() => ({
  updateAnalyticsConfigMock: vi.fn(),
  getAnalyticsSummaryMock: vi.fn(),
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
    updateAnalyticsConfig: updateAnalyticsConfigMock,
    getAnalyticsSummary: getAnalyticsSummaryMock,
  },
}));

import { router } from "../src/trpc";
import {
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
    analyticsUpdateConfig: analyticsUpdateConfigPluginProcedure,
    analyticsSummary: analyticsSummaryPluginProcedure,
  });

  beforeEach(() => {
    updateAnalyticsConfigMock.mockReset();
    getAnalyticsSummaryMock.mockReset();
    organizationFindFirstMock.mockReset();
    selectMock.mockClear();
    selectFromMock.mockClear();
    selectWhereMock.mockReset();
    organizationFindFirstMock.mockResolvedValue({ status: "active" });
    selectWhereMock.mockResolvedValue([]);
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
