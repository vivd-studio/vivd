import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getResolvedSettingsMock } = vi.hoisted(() => ({
  getResolvedSettingsMock: vi.fn(),
}));

vi.mock("../src/services/system/InstanceNetworkSettingsService", () => ({
  instanceNetworkSettingsService: {
    getResolvedSettings: getResolvedSettingsMock,
  },
}));

import { resolveThumbnailPreviewBaseUrl } from "../src/services/project/ThumbnailService";

describe("ThumbnailService preview base resolution", () => {
  const envSnapshot = {
    SCRAPER_URL: process.env.SCRAPER_URL,
    PORT: process.env.PORT,
    DOMAIN: process.env.DOMAIN,
    BACKEND_URL: process.env.BACKEND_URL,
    VIVD_THUMBNAIL_PREVIEW_BASE_URL: process.env.VIVD_THUMBNAIL_PREVIEW_BASE_URL,
  };

  beforeEach(() => {
    getResolvedSettingsMock.mockReset();
    getResolvedSettingsMock.mockReturnValue({
      publicHost: null,
      publicOrigin: null,
      tlsMode: "off",
      acmeEmail: null,
      sources: {
        publicHost: "default",
        tlsMode: "default",
        acmeEmail: "default",
      },
      deploymentManaged: {
        publicHost: false,
      },
    });

    delete process.env.SCRAPER_URL;
    delete process.env.PORT;
    delete process.env.DOMAIN;
    delete process.env.BACKEND_URL;
    delete process.env.VIVD_THUMBNAIL_PREVIEW_BASE_URL;
  });

  afterEach(() => {
    process.env.SCRAPER_URL = envSnapshot.SCRAPER_URL;
    process.env.PORT = envSnapshot.PORT;
    process.env.DOMAIN = envSnapshot.DOMAIN;
    process.env.BACKEND_URL = envSnapshot.BACKEND_URL;
    process.env.VIVD_THUMBNAIL_PREVIEW_BASE_URL =
      envSnapshot.VIVD_THUMBNAIL_PREVIEW_BASE_URL;
  });

  it("uses the internal backend route when the scraper runs on the Docker network", () => {
    process.env.PORT = "3000";
    process.env.SCRAPER_URL = "http://scraper:3001";
    process.env.DOMAIN = "http://49.13.48.211";

    expect(resolveThumbnailPreviewBaseUrl()).toBe("http://backend:3000");
  });

  it("uses the local backend route when the scraper runs on localhost", () => {
    process.env.PORT = "3010";
    process.env.SCRAPER_URL = "http://127.0.0.1:3001";

    expect(resolveThumbnailPreviewBaseUrl()).toBe("http://127.0.0.1:3010");
  });

  it("uses the resolved public origin when the scraper is external", () => {
    process.env.SCRAPER_URL = "https://scraper.example.com";
    process.env.DOMAIN = "http://49.13.48.211";
    getResolvedSettingsMock.mockReturnValue({
      publicHost: "vivd.felixpahlke.de",
      publicOrigin: "https://vivd.felixpahlke.de",
      tlsMode: "external",
      acmeEmail: null,
      sources: {
        publicHost: "settings",
        tlsMode: "settings",
        acmeEmail: "default",
      },
      deploymentManaged: {
        publicHost: false,
      },
    });

    expect(resolveThumbnailPreviewBaseUrl()).toBe("https://vivd.felixpahlke.de");
  });

  it("lets an explicit override win", () => {
    process.env.VIVD_THUMBNAIL_PREVIEW_BASE_URL = "https://preview.internal.example";
    process.env.SCRAPER_URL = "https://scraper.example.com";

    expect(resolveThumbnailPreviewBaseUrl()).toBe("https://preview.internal.example");
  });
});
