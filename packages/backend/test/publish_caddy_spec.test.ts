import { describe, expect, it } from "vitest";
import { buildPublishedSiteAddressSpec } from "../src/services/publish/PublishService";

describe("buildPublishedSiteAddressSpec", () => {
  it("keeps managed-TLS self-host publishes on the exact host", () => {
    expect(
      buildPublishedSiteAddressSpec("example.com", {
        isDev: false,
        caddyTlsMode: "managed",
        includeWwwAlias: false,
      }),
    ).toBe("example.com");
  });

  it("keeps the legacy http-prefixed host labels when Caddy TLS is off", () => {
    expect(
      buildPublishedSiteAddressSpec("example.com", {
        isDev: false,
        caddyTlsMode: "off",
        includeWwwAlias: true,
      }),
    ).toBe("http://example.com, http://www.example.com");
  });

  it("forces plain HTTP for localhost and raw IP publishes", () => {
    expect(
      buildPublishedSiteAddressSpec("localhost", {
        caddyTlsMode: "managed",
      }),
    ).toBe("http://localhost");

    expect(
      buildPublishedSiteAddressSpec("203.0.113.10", {
        caddyTlsMode: "managed",
      }),
    ).toBe("http://203.0.113.10");
  });
});
