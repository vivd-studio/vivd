import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPlaneRateLimitService } from "../src/services/system/ControlPlaneRateLimitService";

const ENV_KEYS = [
  "VIVD_CONTROL_PLANE_RATE_LIMIT_MODE",
  "VIVD_CONTROL_PLANE_RATE_LIMIT_LOG_THROTTLE_MS",
  "VIVD_CONTROL_PLANE_RATE_LIMIT_AUTH_SIGN_IN_MODE",
  "VIVD_CONTROL_PLANE_RATE_LIMIT_AUTH_SIGN_UP_MODE",
  "VIVD_CONTROL_PLANE_RATE_LIMIT_ZIP_IMPORT_MODE",
  "VIVD_AUTH_SIGN_IN_RATE_LIMIT_IP_PER_MINUTE",
  "VIVD_AUTH_SIGN_UP_RATE_LIMIT_IP_PER_10_MINUTES",
  "VIVD_AUTH_PASSWORD_RESET_RATE_LIMIT_IP_PER_10_MINUTES",
  "VIVD_AUTH_VERIFICATION_RATE_LIMIT_IP_PER_10_MINUTES",
  "VIVD_AUTH_MUTATION_RATE_LIMIT_IP_PER_MINUTE",
  "VIVD_PROJECT_GENERATION_RATE_LIMIT_USER_PER_10_MINUTES",
  "VIVD_PROJECT_GENERATION_RATE_LIMIT_ORG_PER_10_MINUTES",
  "VIVD_PROJECT_GENERATION_RATE_LIMIT_IP_PER_10_MINUTES",
  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_USER_PER_10_MINUTES",
  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_ORG_PER_10_MINUTES",
  "VIVD_PROJECT_PUBLISH_RATE_LIMIT_IP_PER_10_MINUTES",
  "VIVD_ZIP_IMPORT_RATE_LIMIT_USER_PER_10_MINUTES",
  "VIVD_ZIP_IMPORT_RATE_LIMIT_ORG_PER_10_MINUTES",
  "VIVD_ZIP_IMPORT_RATE_LIMIT_IP_PER_10_MINUTES",
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

describe("ControlPlaneRateLimitService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    restoreEnv();
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_LOG_THROTTLE_MS = "0";
  });

  afterEach(() => {
    restoreEnv();
  });

  it("defaults to shadow mode so overages do not block", async () => {
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_MODE = "shadow";
    process.env.VIVD_PROJECT_GENERATION_RATE_LIMIT_USER_PER_10_MINUTES = "1";
    process.env.VIVD_PROJECT_GENERATION_RATE_LIMIT_ORG_PER_10_MINUTES = "0";
    process.env.VIVD_PROJECT_GENERATION_RATE_LIMIT_IP_PER_10_MINUTES = "0";
    const service = new ControlPlaneRateLimitService();

    const first = await service.checkAction({
      action: "project_generation",
      organizationId: "org-1",
      requestIp: "203.0.113.10",
      userId: "user-1",
      now: 1_000,
    });
    const second = await service.checkAction({
      action: "project_generation",
      organizationId: "org-1",
      requestIp: "203.0.113.10",
      userId: "user-1",
      now: 2_000,
    });

    expect(first.allowed).toBe(true);
    expect(first.limited).toBe(false);
    expect(second.allowed).toBe(true);
    expect(second.limited).toBe(true);
    expect(second.mode).toBe("shadow");
  });

  it("blocks in enforce mode once a budget is exceeded", async () => {
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_MODE = "enforce";
    process.env.VIVD_PROJECT_PUBLISH_RATE_LIMIT_IP_PER_10_MINUTES = "1";
    process.env.VIVD_PROJECT_PUBLISH_RATE_LIMIT_USER_PER_10_MINUTES = "0";
    process.env.VIVD_PROJECT_PUBLISH_RATE_LIMIT_ORG_PER_10_MINUTES = "0";
    const service = new ControlPlaneRateLimitService();

    const first = await service.checkAction({
      action: "project_publish",
      organizationId: "org-1",
      requestIp: "203.0.113.11",
      userId: "user-1",
      now: 1_000,
    });
    const second = await service.checkAction({
      action: "project_publish",
      organizationId: "org-1",
      requestIp: "203.0.113.11",
      userId: "user-1",
      now: 2_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.limited).toBe(true);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.triggeredBudget?.scope).toBe("ip");
  });

  it("uses request-ip budgets for anonymous auth traffic", async () => {
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_MODE = "shadow";
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_AUTH_SIGN_IN_MODE = "enforce";
    process.env.VIVD_AUTH_SIGN_IN_RATE_LIMIT_IP_PER_MINUTE = "5";
    const service = new ControlPlaneRateLimitService();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const decision = await service.checkAction({
        action: "auth_sign_in",
        organizationId: null,
        requestIp: "203.0.113.12",
        requestPath: "/vivd-studio/api/auth/sign-in/email",
        userId: null,
        now: attempt * 1_000,
      });
      expect(decision.allowed).toBe(true);
    }

    const blocked = await service.checkAction({
      action: "auth_sign_in",
      organizationId: null,
      requestIp: "203.0.113.12",
      requestPath: "/vivd-studio/api/auth/sign-in/email",
      userId: null,
      now: 6_000,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.triggeredBudget?.scope).toBe("ip");
  });

  it("keeps password-reset retries non-blocking by default shadow policy", async () => {
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_MODE = "shadow";
    process.env.VIVD_AUTH_PASSWORD_RESET_RATE_LIMIT_IP_PER_10_MINUTES = "1";
    const service = new ControlPlaneRateLimitService();

    const first = await service.checkAction({
      action: "auth_password_reset",
      organizationId: null,
      requestIp: "203.0.113.14",
      requestPath: "/vivd-studio/api/auth/request-password-reset",
      userId: null,
      now: 0,
    });
    const second = await service.checkAction({
      action: "auth_password_reset",
      organizationId: null,
      requestIp: "203.0.113.14",
      requestPath: "/vivd-studio/api/auth/request-password-reset",
      userId: null,
      now: 1_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.limited).toBe(true);
    expect(second.mode).toBe("shadow");
  });

  it("resets a fixed window after the configured period", async () => {
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_MODE = "shadow";
    process.env.VIVD_CONTROL_PLANE_RATE_LIMIT_ZIP_IMPORT_MODE = "enforce";
    process.env.VIVD_ZIP_IMPORT_RATE_LIMIT_USER_PER_10_MINUTES = "1";
    process.env.VIVD_ZIP_IMPORT_RATE_LIMIT_ORG_PER_10_MINUTES = "0";
    process.env.VIVD_ZIP_IMPORT_RATE_LIMIT_IP_PER_10_MINUTES = "0";
    const service = new ControlPlaneRateLimitService();

    const first = await service.checkAction({
      action: "zip_import",
      organizationId: "org-1",
      requestIp: "203.0.113.13",
      userId: "user-1",
      now: 0,
    });
    const second = await service.checkAction({
      action: "zip_import",
      organizationId: "org-1",
      requestIp: "203.0.113.13",
      userId: "user-1",
      now: 1_000,
    });
    const third = await service.checkAction({
      action: "zip_import",
      organizationId: "org-1",
      requestIp: "203.0.113.13",
      userId: "user-1",
      now: 601_000,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(third.allowed).toBe(true);
    expect(third.limited).toBe(false);
  });
});
