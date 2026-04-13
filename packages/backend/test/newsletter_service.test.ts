import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDefaultSuccessRedirectTarget } from "@vivd/plugin-newsletter/backend/service";
import {
  isHostAllowed,
  normalizeHostCandidate,
} from "../src/services/plugins/runtime/hostUtils";

const deps = {
  hostUtils: {
    isHostAllowed,
    normalizeHostCandidate,
  },
} as any;

describe("newsletter redirect inference", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not persist dedicated Studio hosts into confirmation redirects", () => {
    vi.stubEnv("FLY_STUDIO_APP", "vivd-studio-prod");

    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer: "https://vivd-studio-prod.fly.dev:3111/",
        rawOrigin: "https://vivd-studio-prod.fly.dev:3111",
        allowlist: ["vivd-studio-prod.fly.dev"],
        deps,
      }),
    ).toBeNull();
  });

  it("does not fall back to origin when the referer is a Studio preview path", () => {
    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer:
          "https://preview.example.com/vivd-studio/api/preview/horse-tinder/v1/?view=signup#waitlist",
        rawOrigin: "https://preview.example.com",
        allowlist: ["preview.example.com"],
        deps,
      }),
    ).toBeNull();
  });

  it("still derives success redirects for real published pages", () => {
    const redirectTarget = resolveDefaultSuccessRedirectTarget({
      rawReferer: "https://horse-tinder.example/waitlist?utm_source=launch#join",
      rawOrigin: "https://horse-tinder.example",
      allowlist: ["horse-tinder.example"],
      deps,
    });

    expect(redirectTarget).not.toBeNull();

    const parsed = new URL(redirectTarget!);
    expect(parsed.host).toBe("horse-tinder.example");
    expect(parsed.pathname).toBe("/waitlist");
    expect(parsed.searchParams.get("utm_source")).toBe("launch");
    expect(parsed.searchParams.get("newsletter")).toBe("success");
    expect(parsed.searchParams.get("_vivd_newsletter")).toBe("success");
    expect(parsed.hash).toBe("#join");
  });
});
