import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUsageMock, organizationFindFirstMock } = vi.hoisted(() => ({
  getCurrentUsageMock: vi.fn(),
  organizationFindFirstMock: vi.fn(),
}));

vi.mock("../src/services/usage/UsageService", () => ({
  usageService: {
    getCurrentUsage: getCurrentUsageMock,
  },
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      organization: {
        findFirst: organizationFindFirstMock,
      },
    },
  },
}));

import { limitsService } from "../src/services/usage/LimitsService";

const ENV_KEYS = [
  "LICENSE_DAILY_CREDIT_LIMIT",
  "LICENSE_WEEKLY_CREDIT_LIMIT",
  "LICENSE_MONTHLY_CREDIT_LIMIT",
  "LICENSE_IMAGE_GEN_PER_MONTH",
  "LICENSE_WARNING_THRESHOLD",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function restoreEnv(): void {
  for (const [key, value] of originalEnv) {
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
}

describe("LimitsService", () => {
  beforeEach(() => {
    getCurrentUsageMock.mockReset();
    organizationFindFirstMock.mockReset();
    organizationFindFirstMock.mockResolvedValue({ limits: null });

    process.env.LICENSE_DAILY_CREDIT_LIMIT = "100";
    process.env.LICENSE_WEEKLY_CREDIT_LIMIT = "1000";
    process.env.LICENSE_MONTHLY_CREDIT_LIMIT = "5000";
    process.env.LICENSE_IMAGE_GEN_PER_MONTH = "10";
    process.env.LICENSE_WARNING_THRESHOLD = "0.8";
  });

  afterEach(() => {
    restoreEnv();
  });

  it("marks organization as blocked when a credit limit is reached", async () => {
    getCurrentUsageMock.mockResolvedValue({
      daily: { cost: 1.0, imageCount: 0, periodStart: new Date() },
      weekly: { cost: 2.0, imageCount: 0, periodStart: new Date() },
      monthly: { cost: 2.5, imageCount: 2, periodStart: new Date() },
    });

    const result = await limitsService.checkLimits("org-1");

    expect(result.blocked).toBe(true);
    expect(result.warnings.some((msg) => msg.includes("Daily usage limit reached"))).toBe(
      true,
    );
    expect(result.usage.daily.current).toBe(100);
    expect(result.usage.daily.limit).toBe(100);
  });

  it("emits threshold warnings before limits are exceeded", async () => {
    getCurrentUsageMock.mockResolvedValue({
      daily: { cost: 0.8, imageCount: 0, periodStart: new Date() },
      weekly: { cost: 0.0, imageCount: 0, periodStart: new Date() },
      monthly: { cost: 0.0, imageCount: 0, periodStart: new Date() },
    });

    const result = await limitsService.checkLimits("org-1");

    expect(result.blocked).toBe(false);
    expect(
      result.warnings.some((msg) => msg.includes("Approaching daily limit")),
    ).toBe(true);
  });

  it("throws image-specific errors when only image usage is blocked", async () => {
    getCurrentUsageMock.mockResolvedValue({
      daily: { cost: 0.1, imageCount: 0, periodStart: new Date() },
      weekly: { cost: 0.1, imageCount: 0, periodStart: new Date() },
      monthly: { cost: 0.1, imageCount: 10, periodStart: new Date() },
    });

    await expect(limitsService.assertImageGenNotBlocked("org-1")).rejects.toThrow(
      "Image generation limit reached: 10/10 images this month",
    );
  });

  it("applies organization-specific limit overrides", async () => {
    organizationFindFirstMock.mockResolvedValueOnce({
      limits: {
        dailyCreditLimit: 50,
        weeklyCreditLimit: 120,
        monthlyCreditLimit: 999,
        imageGenPerMonth: 7,
        warningThreshold: 0.15,
      },
    });
    getCurrentUsageMock.mockResolvedValue({
      daily: { cost: 0.5, imageCount: 0, periodStart: new Date() }, // 50 credits
      weekly: { cost: 1.0, imageCount: 0, periodStart: new Date() }, // 100 credits
      monthly: { cost: 1.2, imageCount: 6, periodStart: new Date() }, // 120 credits
    });

    const result = await limitsService.checkLimits("org-1");

    expect(result.blocked).toBe(true);
    expect(result.imageGenBlocked).toBe(false);
    expect(result.usage.daily.limit).toBe(50);
    expect(result.usage.weekly.limit).toBe(120);
    expect(result.usage.monthly.limit).toBe(999);
    expect(result.usage.imageGen.limit).toBe(7);
  });

  it("treats zero limits as unlimited", async () => {
    process.env.LICENSE_DAILY_CREDIT_LIMIT = "0";
    process.env.LICENSE_WEEKLY_CREDIT_LIMIT = "0";
    process.env.LICENSE_MONTHLY_CREDIT_LIMIT = "0";
    process.env.LICENSE_IMAGE_GEN_PER_MONTH = "0";
    getCurrentUsageMock.mockResolvedValue({
      daily: { cost: 999, imageCount: 0, periodStart: new Date() },
      weekly: { cost: 999, imageCount: 0, periodStart: new Date() },
      monthly: { cost: 999, imageCount: 999, periodStart: new Date() },
    });

    const result = await limitsService.checkLimits("org-1");

    expect(result.blocked).toBe(false);
    expect(result.imageGenBlocked).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.usage.daily.percentage).toBe(0);
    expect(result.usage.weekly.percentage).toBe(0);
    expect(result.usage.monthly.percentage).toBe(0);
    expect(result.usage.imageGen.percentage).toBe(0);
  });

  it("falls back to env config when organization limit lookup fails", async () => {
    process.env.LICENSE_DAILY_CREDIT_LIMIT = "20";
    organizationFindFirstMock.mockRejectedValueOnce(new Error("db unavailable"));
    getCurrentUsageMock.mockResolvedValue({
      daily: { cost: 0.2, imageCount: 0, periodStart: new Date() }, // 20 credits
      weekly: { cost: 0.1, imageCount: 0, periodStart: new Date() },
      monthly: { cost: 0.1, imageCount: 0, periodStart: new Date() },
    });

    const result = await limitsService.checkLimits("org-1");

    expect(result.blocked).toBe(true);
    expect(result.usage.daily.limit).toBe(20);
  });
});
