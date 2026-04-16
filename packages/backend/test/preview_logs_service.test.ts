import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolvePolicyMock,
  getUrlMock,
  capturePreviewLogsMock,
} = vi.hoisted(() => ({
  resolvePolicyMock: vi.fn(),
  getUrlMock: vi.fn(),
  capturePreviewLogsMock: vi.fn(),
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    resolvePolicy: resolvePolicyMock,
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
    capturePreviewLogs: capturePreviewLogsMock,
  },
}));

import { previewLogsService } from "../src/services/project/PreviewLogsService";

describe("PreviewLogsService", () => {
  beforeEach(() => {
    resolvePolicyMock.mockReset();
    getUrlMock.mockReset();
    capturePreviewLogsMock.mockReset();

    resolvePolicyMock.mockResolvedValue({
      controlPlane: { mode: "path_based" },
    });
    getUrlMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://studio.example:4100",
      runtimeUrl: "https://studio.example:4100",
      compatibilityUrl: "https://app.example/_studio/runtime-1",
      accessToken: "studio-token",
    });
    capturePreviewLogsMock.mockResolvedValue({
      url: "https://app.example/_studio/runtime-1/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
      entries: [
        {
          type: "error",
          text: "Hydration failed",
          timestamp: "2026-04-09T10:00:00.000Z",
          textTruncated: false,
        },
      ],
      summary: {
        observed: 6,
        matched: 1,
        returned: 1,
        dropped: 0,
        truncatedMessages: 0,
      },
    });
  });

  it("captures preview logs through the scraper with studio auth headers and filters", async () => {
    const result = await previewLogsService.capture({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
      path: "/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
    });

    expect(getUrlMock).toHaveBeenCalledWith("org-1", "site-1", 2);
    expect(capturePreviewLogsMock).toHaveBeenCalledWith({
      url: "https://app.example/_studio/runtime-1/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
      headers: {
        "x-vivd-studio-token": "studio-token",
        "x-vivd-organization-id": "org-1",
      },
    });
    expect(result).toEqual({
      path: "/pricing",
      capturedUrl: "https://app.example/_studio/runtime-1/pricing",
      waitMs: 1200,
      limit: 10,
      level: "warn",
      contains: "hydrate",
      entries: [
        {
          type: "error",
          text: "Hydration failed",
          timestamp: "2026-04-09T10:00:00.000Z",
          textTruncated: false,
        },
      ],
      summary: {
        observed: 6,
        matched: 1,
        returned: 1,
        dropped: 0,
        truncatedMessages: 0,
      },
    });
  });

  it("uses the backend runtime URL when browser-facing preview URLs are local-only", async () => {
    getUrlMock.mockResolvedValue({
      studioId: "studio-1",
      url: "http://app.localhost:4100",
      runtimeUrl: "http://app.localhost:4100",
      compatibilityUrl: "http://app.localhost/_studio/runtime-1",
      backendUrl: "http://studio-site-1-v1-a3f6fad7ba:3100",
      accessToken: "studio-token",
    });

    await previewLogsService.capture({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
      path: "/pricing",
    });

    expect(capturePreviewLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://studio-site-1-v1-a3f6fad7ba:3100/pricing",
      }),
    );
  });
});
