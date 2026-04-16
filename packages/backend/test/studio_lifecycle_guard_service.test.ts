import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioLifecycleGuardService } from "../src/services/system/StudioLifecycleGuardService";

const ENV_KEYS = [
  "VIVD_STUDIO_LIFECYCLE_GUARD_MODE",
  "VIVD_STUDIO_LIFECYCLE_GUARD_LOG_THROTTLE_MS",
  "VIVD_STUDIO_START_LIMIT_USER_PER_MINUTE",
  "VIVD_STUDIO_START_LIMIT_ORG_PER_MINUTE",
  "VIVD_STUDIO_START_LIMIT_IP_PER_MINUTE",
  "VIVD_STUDIO_HARD_RESTART_LIMIT_USER_PER_10_MINUTES",
  "VIVD_STUDIO_HARD_RESTART_LIMIT_ORG_PER_10_MINUTES",
  "VIVD_STUDIO_HARD_RESTART_LIMIT_IP_PER_10_MINUTES",
  "VIVD_STUDIO_HARD_RESTART_LIMIT_PROJECT_PER_10_MINUTES",
  "VIVD_STUDIO_TOUCH_LIMIT_USER_PER_MINUTE",
  "VIVD_STUDIO_TOUCH_LIMIT_IP_PER_MINUTE",
  "VIVD_STUDIO_TOUCH_LIMIT_PROJECT_PER_MINUTE",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function restoreEnv() {
  for (const [key, value] of originalEnv) {
    if (typeof value === "string") process.env[key] = value;
    else delete process.env[key];
  }
}

describe("StudioLifecycleGuardService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    restoreEnv();
    process.env.VIVD_STUDIO_LIFECYCLE_GUARD_LOG_THROTTLE_MS = "0";
  });

  afterEach(() => {
    restoreEnv();
  });

  it("defaults to shadow mode so overages do not block users", () => {
    process.env.VIVD_STUDIO_LIFECYCLE_GUARD_MODE = "shadow";
    process.env.VIVD_STUDIO_START_LIMIT_USER_PER_MINUTE = "1";
    const service = new StudioLifecycleGuardService();

    const first = service.checkAction({
      action: "startStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.1",
      userId: "user-1",
      version: 1,
      now: 1_000,
    });
    const second = service.checkAction({
      action: "startStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.1",
      userId: "user-1",
      version: 1,
      now: 2_000,
    });

    expect(first.allowed).toBe(true);
    expect(first.limited).toBe(false);
    expect(second.allowed).toBe(true);
    expect(second.limited).toBe(true);
    expect(second.mode).toBe("shadow");
  });

  it("blocks when enforce mode is enabled and a budget is exceeded", () => {
    process.env.VIVD_STUDIO_LIFECYCLE_GUARD_MODE = "enforce";
    process.env.VIVD_STUDIO_HARD_RESTART_LIMIT_USER_PER_10_MINUTES = "1";
    const service = new StudioLifecycleGuardService();

    const first = service.checkAction({
      action: "hardRestartStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.1",
      userId: "user-1",
      version: 2,
      now: 1_000,
    });
    const second = service.checkAction({
      action: "hardRestartStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.1",
      userId: "user-1",
      version: 2,
      now: 2_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.limited).toBe(true);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.triggeredBudget?.scope).toBe("user");
  });

  it("resets a fixed window after the configured period", () => {
    process.env.VIVD_STUDIO_LIFECYCLE_GUARD_MODE = "enforce";
    process.env.VIVD_STUDIO_TOUCH_LIMIT_IP_PER_MINUTE = "1";
    process.env.VIVD_STUDIO_TOUCH_LIMIT_USER_PER_MINUTE = "0";
    process.env.VIVD_STUDIO_TOUCH_LIMIT_PROJECT_PER_MINUTE = "0";
    const service = new StudioLifecycleGuardService();

    const first = service.checkAction({
      action: "touchStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.2",
      userId: "user-1",
      version: 1,
      now: 0,
    });
    const second = service.checkAction({
      action: "touchStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.2",
      userId: "user-1",
      version: 1,
      now: 1_000,
    });
    const third = service.checkAction({
      action: "touchStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.2",
      userId: "user-1",
      version: 1,
      now: 61_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(third.allowed).toBe(true);
    expect(third.limited).toBe(false);
  });

  it("treats off mode as a no-op even when limits are configured", () => {
    process.env.VIVD_STUDIO_LIFECYCLE_GUARD_MODE = "off";
    process.env.VIVD_STUDIO_START_LIMIT_USER_PER_MINUTE = "1";
    const service = new StudioLifecycleGuardService();

    const first = service.checkAction({
      action: "startStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.3",
      userId: "user-1",
      version: 1,
      now: 0,
    });
    const second = service.checkAction({
      action: "startStudio",
      organizationId: "org-1",
      projectSlug: "demo",
      requestIp: "203.0.113.3",
      userId: "user-1",
      version: 1,
      now: 1_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.limited).toBe(false);
    expect(second.mode).toBe("off");
  });
});
