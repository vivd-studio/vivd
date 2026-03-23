import { beforeEach, describe, expect, it, vi } from "vitest";

const { getResolvedSettingsMock } = vi.hoisted(() => ({
  getResolvedSettingsMock: vi.fn(),
}));

vi.mock("../src/services/system/InstanceNetworkSettingsService", () => ({
  instanceNetworkSettingsService: {
    getResolvedSettings: getResolvedSettingsMock,
  },
}));

describe("buildPublishedSiteAddressSpec default TLS fallback", () => {
  beforeEach(() => {
    getResolvedSettingsMock.mockReset();
  });

  it("keeps publishes on http-prefixed host labels when TLS mode is only an implicit default", async () => {
    vi.resetModules();
    delete process.env.VIVD_CADDY_TLS_MODE;

    getResolvedSettingsMock.mockReturnValue({
      tlsMode: "managed",
      sources: {
        tlsMode: "default",
      },
    });

    const { buildPublishedSiteAddressSpec } = await import(
      "../src/services/publish/PublishService"
    );

    expect(
      buildPublishedSiteAddressSpec("example.com", {
        isDev: false,
        includeWwwAlias: false,
      }),
    ).toBe("http://example.com");
  });
});
