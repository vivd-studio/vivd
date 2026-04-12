import { describe, expect, it, vi } from "vitest";
import {
  createAnalyticsCountryResolver,
  detectCountryCodeFromHeaders,
  extractClientIpFromRequest,
  readAnalyticsGeolocationRuntimeConfig,
  type AnalyticsGeoRequest,
} from "@vivd/plugin-analytics/backend/http/geolocation";

function makeRequest(headers: Record<string, string> = {}, ip?: string): AnalyticsGeoRequest {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    get(name: string) {
      return normalizedHeaders[name.toLowerCase()];
    },
    ip,
  };
}

describe("analytics geolocation helpers", () => {
  it("defaults geolocation mode to auto with the standard GeoLite path", () => {
    expect(readAnalyticsGeolocationRuntimeConfig({})).toEqual({
      mode: "auto",
      maxMindDbPath: "/app/geoip/GeoLite2-Country.mmdb",
    });
  });

  it("reads country codes from common proxy and CDN headers", () => {
    expect(detectCountryCodeFromHeaders(makeRequest({ "cf-ipcountry": "de" }))).toBe("DE");
    expect(
      detectCountryCodeFromHeaders(makeRequest({ "x-vercel-ip-country": "us" })),
    ).toBe("US");
    expect(
      detectCountryCodeFromHeaders(makeRequest({ "cloudfront-viewer-country": "FR" })),
    ).toBe("FR");
  });

  it("extracts the client ip from forwarded headers in a provider-agnostic order", () => {
    expect(
      extractClientIpFromRequest(
        makeRequest({ "x-forwarded-for": "203.0.113.8, 10.0.0.4, 10.0.0.5" }),
      ),
    ).toBe("203.0.113.8");

    expect(
      extractClientIpFromRequest(
        makeRequest({ forwarded: 'for="[2001:db8:cafe::17]:4711";proto=https' }),
      ),
    ).toBe("2001:db8:cafe::17");

    expect(
      extractClientIpFromRequest(makeRequest({}, "::ffff:198.51.100.22")),
    ).toBe("198.51.100.22");
  });
});

describe("analytics country resolver", () => {
  it("prefers explicit country codes before any server-side detection", async () => {
    const openReader = vi.fn();
    const resolver = createAnalyticsCountryResolver({
      config: {
        mode: "auto",
        maxMindDbPath: "/tmp/GeoLite2-Country.mmdb",
      },
      openReader,
      logger: { warn: vi.fn() },
    });

    const countryCode = await resolver.resolveCountryCode(
      makeRequest({ "cf-ipcountry": "DE" }),
      "NL",
    );

    expect(countryCode).toBe("NL");
    expect(openReader).not.toHaveBeenCalled();
  });

  it("uses header-based country detection in auto mode without opening the GeoIP db", async () => {
    const openReader = vi.fn();
    const resolver = createAnalyticsCountryResolver({
      config: {
        mode: "auto",
        maxMindDbPath: "/tmp/GeoLite2-Country.mmdb",
      },
      openReader,
      logger: { warn: vi.fn() },
    });

    const countryCode = await resolver.resolveCountryCode(
      makeRequest({ "x-vercel-ip-country": "US" }),
    );

    expect(countryCode).toBe("US");
    expect(openReader).not.toHaveBeenCalled();
  });

  it("falls back to MaxMind lookup from the parsed client ip when headers are absent", async () => {
    const get = vi.fn().mockReturnValue({
      country: { iso_code: "JP" },
    });
    const openReader = vi.fn().mockResolvedValue({ get });

    const resolver = createAnalyticsCountryResolver({
      config: {
        mode: "auto",
        maxMindDbPath: "/tmp/GeoLite2-Country.mmdb",
      },
      openReader,
      logger: { warn: vi.fn() },
    });

    const countryCode = await resolver.resolveCountryCode(
      makeRequest({ "x-forwarded-for": "198.51.100.8, 10.0.0.4" }),
    );

    expect(countryCode).toBe("JP");
    expect(openReader).toHaveBeenCalledWith("/tmp/GeoLite2-Country.mmdb");
    expect(get).toHaveBeenCalledWith("198.51.100.8");
  });

  it("supports strict headers-only mode", async () => {
    const openReader = vi.fn();
    const resolver = createAnalyticsCountryResolver({
      config: {
        mode: "headers",
        maxMindDbPath: "/tmp/GeoLite2-Country.mmdb",
      },
      openReader,
      logger: { warn: vi.fn() },
    });

    const countryCode = await resolver.resolveCountryCode(
      makeRequest({ "x-forwarded-for": "198.51.100.8" }),
    );

    expect(countryCode).toBeNull();
    expect(openReader).not.toHaveBeenCalled();
  });
});
