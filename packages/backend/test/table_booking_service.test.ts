import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDefaultSuccessRedirectTarget } from "@vivd/plugin-table-booking/backend/service";
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

describe("table booking redirect inference", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives success redirects from allowed published pages", () => {
    const redirectTarget = resolveDefaultSuccessRedirectTarget({
      rawReferer:
        "https://restaurant.example/reserve?utm_source=launch#booking-widget",
      rawOrigin: "https://restaurant.example",
      allowlist: ["restaurant.example"],
      deps,
    });

    expect(redirectTarget).not.toBeNull();

    const parsed = new URL(redirectTarget!);
    expect(parsed.host).toBe("restaurant.example");
    expect(parsed.pathname).toBe("/reserve");
    expect(parsed.searchParams.get("utm_source")).toBe("launch");
    expect(parsed.searchParams.get("booking")).toBe("success");
    expect(parsed.searchParams.get("_vivd_booking")).toBe("success");
    expect(parsed.hash).toBe("#booking-widget");
  });

  it("rejects redirect inference for disallowed hosts", () => {
    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer: "https://restaurant.example/reserve",
        rawOrigin: "https://restaurant.example",
        allowlist: ["other.example"],
        deps,
      }),
    ).toBeNull();
  });

  it("does not persist local or studio preview hosts into guest flows", () => {
    vi.stubEnv("FLY_STUDIO_APP", "vivd-studio-prod");

    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer:
          "https://preview.example.com/vivd-studio/api/preview/restaurant/v1/?view=booking#widget",
        rawOrigin: "https://preview.example.com",
        allowlist: ["preview.example.com"],
        deps,
      }),
    ).toBeNull();

    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer: "http://localhost:4321/reserve",
        rawOrigin: "http://localhost:4321",
        allowlist: ["localhost:4321"],
        deps,
      }),
    ).toBeNull();

    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer: "https://vivd-studio-prod.fly.dev/reserve",
        rawOrigin: "https://vivd-studio-prod.fly.dev",
        allowlist: ["vivd-studio-prod.fly.dev"],
        deps,
      }),
    ).toBeNull();
  });
});
