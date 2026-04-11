import { describe, expect, it } from "vitest";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  normalizeHostCandidate,
  resolveDefaultSuccessRedirectTarget,
  resolveEffectiveRedirectHosts,
  resolveEffectiveSourceHosts,
  resolveRedirectTarget,
} from "../src/services/plugins/runtime/hostUtils";

describe("public plugins host helpers", () => {
  it("normalizes host candidates", () => {
    expect(normalizeHostCandidate("https://API.Localhost:443/path")).toBe(
      "api.localhost",
    );
    expect(normalizeHostCandidate("api.localhost:80")).toBe("api.localhost");
    expect(normalizeHostCandidate("api.localhost:3000")).toBe("api.localhost:3000");
    expect(normalizeHostCandidate("")).toBeNull();
    expect(normalizeHostCandidate("not a host")).toBeNull();
  });

  it("extracts source host from origin then referer", () => {
    expect(
      extractSourceHostFromHeaders({
        origin: "https://preview.localhost:8443",
        referer: "https://ignored.localhost/contact",
      }),
    ).toBe("preview.localhost:8443");

    expect(
      extractSourceHostFromHeaders({
        origin: null,
        referer: "https://site.localhost/contact",
      }),
    ).toBe("site.localhost");
  });

  it("matches allowlist by host or hostname", () => {
    expect(isHostAllowed("site.localhost:3000", ["site.localhost"])).toBe(true);
    expect(isHostAllowed("site.localhost", ["site.localhost:3000"])).toBe(true);
    expect(isHostAllowed("unknown.localhost", ["site.localhost"])).toBe(false);
    expect(isHostAllowed(null, ["site.localhost"])).toBe(false);
    expect(isHostAllowed("any.localhost", [])).toBe(true);
  });

  it("resolves redirect only for allowlisted hosts", () => {
    expect(
      resolveRedirectTarget(
        "https://site.localhost/thanks",
        ["site.localhost", "preview.localhost"],
      ),
    ).toBe("https://site.localhost/thanks");

    expect(resolveRedirectTarget("https://evil.localhost/thanks", ["site.localhost"])).toBeNull();
    expect(resolveRedirectTarget("/thanks", ["site.localhost"])).toBeNull();
    expect(resolveRedirectTarget("https://site.localhost/thanks", [])).toBeNull();
  });

  it("derives effective source and redirect allowlists", () => {
    expect(
      resolveEffectiveSourceHosts(
        ["WWW.Site.localhost", "site.localhost:443"],
        ["preview.localhost"],
      ),
    ).toEqual(["www.site.localhost", "site.localhost"]);

    expect(
      resolveEffectiveSourceHosts([], ["preview.localhost", "preview.localhost:443"]),
    ).toEqual(["preview.localhost"]);

    expect(
      resolveEffectiveRedirectHosts([], ["preview.localhost", "site.localhost"]),
    ).toEqual(["preview.localhost", "site.localhost"]);

    expect(
      resolveEffectiveRedirectHosts(
        ["www.site.localhost", "site.localhost:443"],
        ["preview.localhost"],
      ),
    ).toEqual(["www.site.localhost", "site.localhost"]);
  });

  it("derives fallback success redirects from referer or origin", () => {
    const refererFallback = resolveDefaultSuccessRedirectTarget({
      rawReferer: "https://site.localhost/contact?utm=1#form",
      rawOrigin: "https://ignored.localhost",
      allowlist: ["site.localhost", "preview.localhost"],
    });
    expect(refererFallback).not.toBeNull();

    const parsedRefererFallback = new URL(refererFallback!);
    expect(parsedRefererFallback.host).toBe("site.localhost");
    expect(parsedRefererFallback.pathname).toBe("/contact");
    expect(parsedRefererFallback.searchParams.get("utm")).toBe("1");
    expect(parsedRefererFallback.searchParams.get("_vivd_contact")).toBe("success");
    expect(parsedRefererFallback.hash).toBe("#form");

    const originFallback = resolveDefaultSuccessRedirectTarget({
      rawReferer: null,
      rawOrigin: "https://preview.localhost",
      allowlist: ["preview.localhost"],
    });
    expect(originFallback).toBe("https://preview.localhost/?_vivd_contact=success");
  });

  it("returns null fallback redirect when no allowed source URL exists", () => {
    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer: "https://evil.localhost/contact",
        rawOrigin: "https://also-evil.localhost",
        allowlist: ["site.localhost"],
      }),
    ).toBeNull();

    expect(
      resolveDefaultSuccessRedirectTarget({
        rawReferer: "https://site.localhost/contact",
        rawOrigin: "https://site.localhost",
        allowlist: [],
      }),
    ).toBeNull();
  });
});
