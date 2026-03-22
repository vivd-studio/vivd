import { describe, expect, it } from "vitest";
import { resolveAuthBaseUrlFromEnv } from "../src/lib/publicOrigin";

describe("resolveAuthBaseUrlFromEnv", () => {
  it("prefers explicit auth envs over inferred hosts", () => {
    expect(
      resolveAuthBaseUrlFromEnv({
        VIVD_APP_URL: "https://app.example.com",
        BETTER_AUTH_URL: "https://legacy.example.com",
        CONTROL_PLANE_HOST: "control.example.com",
        DOMAIN: "https://example.com",
      } as NodeJS.ProcessEnv),
    ).toBe("https://app.example.com");
  });

  it("falls back to DOMAIN for single-host installs", () => {
    expect(
      resolveAuthBaseUrlFromEnv({
        DOMAIN: "https://example.com",
      } as NodeJS.ProcessEnv),
    ).toBe("https://example.com");
  });

  it("infers http for raw IP domains", () => {
    expect(
      resolveAuthBaseUrlFromEnv({
        DOMAIN: "203.0.113.10",
      } as NodeJS.ProcessEnv),
    ).toBe("http://203.0.113.10");
  });
});
