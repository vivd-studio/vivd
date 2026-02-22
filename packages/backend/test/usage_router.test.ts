import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkLimitsMock,
  getCurrentUsageMock,
  getUsageHistoryMock,
  getSessionUsageMock,
  getFlowUsageMock,
} = vi.hoisted(() => ({
  checkLimitsMock: vi.fn(),
  getCurrentUsageMock: vi.fn(),
  getUsageHistoryMock: vi.fn(),
  getSessionUsageMock: vi.fn(),
  getFlowUsageMock: vi.fn(),
}));

vi.mock("../src/services/usage/LimitsService", () => ({
  limitsService: {
    checkLimits: checkLimitsMock,
  },
}));

vi.mock("../src/services/usage/UsageService", () => ({
  usageService: {
    getCurrentUsage: getCurrentUsageMock,
    getUsageHistory: getUsageHistoryMock,
    getSessionUsage: getSessionUsageMock,
    getFlowUsage: getFlowUsageMock,
  },
}));

import { usageRouter } from "../src/routers/usage";

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

describe("usage router", () => {
  beforeEach(() => {
    checkLimitsMock.mockReset();
    getCurrentUsageMock.mockReset();
    getUsageHistoryMock.mockReset();
    getSessionUsageMock.mockReset();
    getFlowUsageMock.mockReset();

    checkLimitsMock.mockResolvedValue({
      blocked: false,
      warning: false,
      reason: null,
      usage: {},
      limits: {},
    });
    getCurrentUsageMock.mockResolvedValue({ totalCost: 12.34 });
    getUsageHistoryMock.mockResolvedValue([]);
    getSessionUsageMock.mockResolvedValue([]);
    getFlowUsageMock.mockResolvedValue([]);
  });

  it("returns limit status for the active organization", async () => {
    const caller = usageRouter.createCaller(makeContext());

    const result = await caller.status();

    expect(checkLimitsMock).toHaveBeenCalledWith("org-1");
    expect(result).toMatchObject({ blocked: false });
  });

  it("returns current usage aggregates for the active organization", async () => {
    const caller = usageRouter.createCaller(makeContext());

    const result = await caller.current();

    expect(getCurrentUsageMock).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({ totalCost: 12.34 });
  });

  it("defaults history lookback to 30 days", async () => {
    const caller = usageRouter.createCaller(makeContext());

    await caller.history();

    expect(getUsageHistoryMock).toHaveBeenCalledWith("org-1", 30);
  });

  it("passes explicit lookback for session usage", async () => {
    const caller = usageRouter.createCaller(makeContext());

    await caller.sessions({ days: 14 });

    expect(getSessionUsageMock).toHaveBeenCalledWith("org-1", 14);
  });

  it("defaults flow usage lookback to 30 days", async () => {
    const caller = usageRouter.createCaller(makeContext());

    await caller.flows({});

    expect(getFlowUsageMock).toHaveBeenCalledWith("org-1", 30);
  });
});
