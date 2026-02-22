import { describe, expect, it } from "vitest";
import {
  extractSourceHostFromHeaders,
  isHostAllowed,
  normalizeHostCandidate,
  resolveEffectiveRedirectHosts,
  resolveEffectiveSourceHosts,
  resolveRedirectTarget,
} from "../src/routes/plugins/contactForm/helpers";

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
});
