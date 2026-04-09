import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getInstallProfileMock,
  getUrlMock,
  captureScreenshotMock,
} = vi.hoisted(() => ({
  getInstallProfileMock: vi.fn(),
  getUrlMock: vi.fn(),
  captureScreenshotMock: vi.fn(),
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    getInstallProfile: getInstallProfileMock,
  },
}));

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: {
    kind: "docker",
    getUrl: getUrlMock,
  },
}));

vi.mock("../src/generator/scraper-client", () => ({
  scraperClient: {
    captureScreenshot: captureScreenshotMock,
  },
}));

import {
  buildPreviewScreenshotFilename,
  normalizePreviewScreenshotPath,
  previewScreenshotService,
  resolvePreviewScreenshotBaseUrl,
  resolvePreviewScreenshotUrl,
} from "../src/services/project/PreviewScreenshotService";

describe("PreviewScreenshotService", () => {
  beforeEach(() => {
    getInstallProfileMock.mockReset();
    getUrlMock.mockReset();
    captureScreenshotMock.mockReset();

    getInstallProfileMock.mockResolvedValue("solo");
    getUrlMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://studio.example:4100",
      runtimeUrl: "https://studio.example:4100",
      compatibilityUrl: "https://app.example/_studio/runtime-1",
      accessToken: "studio-token",
    });
    captureScreenshotMock.mockResolvedValue({
      url: "https://app.example/_studio/runtime-1/pricing",
      data: "base64-image",
      filename: "preview-pricing-1600x1000-x0-y1200.png",
      mimeType: "image/png",
    });
  });

  it("normalizes preview-relative paths and rejects absolute URLs", () => {
    expect(normalizePreviewScreenshotPath("pricing?tab=pro")).toBe("/pricing?tab=pro");
    expect(() => normalizePreviewScreenshotPath("https://example.com")).toThrow(
      "Preview path must be preview-relative",
    );
  });

  it("builds stable filenames from path, viewport, and scroll position", () => {
    expect(
      buildPreviewScreenshotFilename({
        path: "/pricing",
        width: 1600,
        height: 1000,
        scrollX: 0,
        scrollY: 1200,
        format: "png",
      }),
    ).toBe("preview-pricing-1600x1000-x0-y1200.png");
  });

  it("prefers compatibility routes for solo installs and resolves preview-relative paths under them", () => {
    const baseUrl = resolvePreviewScreenshotBaseUrl({
      installProfile: "solo",
      backendUrl: null,
      runtimeUrl: "https://studio.example:4100",
      compatibilityUrl: "https://app.example/_studio/runtime-1",
      url: "https://studio.example:4100",
    });

    expect(baseUrl).toBe("https://app.example/_studio/runtime-1");
    expect(resolvePreviewScreenshotUrl(baseUrl, "/pricing?tab=pro")).toBe(
      "https://app.example/_studio/runtime-1/pricing?tab=pro",
    );
  });

  it("prefers the backend runtime URL when browser-facing preview URLs are local-only", () => {
    const baseUrl = resolvePreviewScreenshotBaseUrl({
      installProfile: "solo",
      backendUrl: "http://studio-site-1-v1-a3f6fad7ba:3100",
      runtimeUrl: "http://app.localhost:4100",
      compatibilityUrl: "http://app.localhost/_studio/runtime-1",
      url: "http://app.localhost:4100",
    });

    expect(baseUrl).toBe("http://studio-site-1-v1-a3f6fad7ba:3100");
  });

  it("captures the live preview through the scraper with studio auth headers", async () => {
    const result = await previewScreenshotService.capture({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
      path: "/pricing",
      width: 1600,
      height: 1000,
      scrollY: 1200,
    });

    expect(getUrlMock).toHaveBeenCalledWith("org-1", "site-1", 2);
    expect(captureScreenshotMock).toHaveBeenCalledWith({
      url: "https://app.example/_studio/runtime-1/pricing",
      width: 1600,
      height: 1000,
      scrollX: 0,
      scrollY: 1200,
      waitMs: 500,
      format: "png",
      filename: "preview-pricing-1600x1000-x0-y1200.png",
      headers: {
        "x-vivd-studio-token": "studio-token",
        "x-vivd-organization-id": "org-1",
      },
    });
    expect(result).toMatchObject({
      path: "/pricing",
      capturedUrl: "https://app.example/_studio/runtime-1/pricing",
      filename: "preview-pricing-1600x1000-x0-y1200.png",
      mimeType: "image/png",
      width: 1600,
      height: 1000,
      scrollY: 1200,
      imageBase64: "base64-image",
    });
  });
});
