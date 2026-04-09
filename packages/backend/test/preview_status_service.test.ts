import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUrlMock,
} = vi.hoisted(() => ({
  getUrlMock: vi.fn(),
}));

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: {
    kind: "docker",
    getUrl: getUrlMock,
  },
}));

import { previewStatusService } from "../src/services/project/PreviewStatusService";

describe("PreviewStatusService", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    getUrlMock.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns stopped status when the studio runtime is not running", async () => {
    getUrlMock.mockResolvedValue(null);

    const result = await previewStatusService.getStatus({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
    });

    expect(result).toEqual({
      provider: "docker",
      runtime: {
        running: false,
        health: "stopped",
        browserUrl: null,
        runtimeUrl: null,
        compatibilityUrl: null,
      },
      preview: {
        mode: "unknown",
        status: "unavailable",
        error: "Studio runtime is not running",
      },
      devServer: {
        applicable: false,
        running: false,
        status: "unknown",
      },
    });
  });

  it("reads runtime health and preview info to report dev server readiness", async () => {
    getUrlMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://preview.example.test",
      backendUrl: "http://127.0.0.1:3100",
      runtimeUrl: "https://runtime.example.test",
      compatibilityUrl: "https://app.example/_studio/runtime-1",
      accessToken: "studio-token",
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok", initialized: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            data: {
              json: {
                mode: "devserver",
                status: "ready",
                url: "/",
              },
            },
          },
        }),
      });

    const result = await previewStatusService.getStatus({
      organizationId: "org-1",
      projectSlug: "site-1",
      version: 2,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3100/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "http://127.0.0.1:3100/vivd-studio/api/trpc/project.getPreviewInfo?input=",
      ),
      expect.objectContaining({
        method: "GET",
        headers: {
          "x-vivd-studio-token": "studio-token",
        },
      }),
    );
    expect(result).toEqual({
      provider: "docker",
      runtime: {
        running: true,
        health: "ok",
        browserUrl: "https://preview.example.test",
        runtimeUrl: "https://runtime.example.test",
        compatibilityUrl: "https://app.example/_studio/runtime-1",
      },
      preview: {
        mode: "devserver",
        status: "ready",
        error: undefined,
      },
      devServer: {
        applicable: true,
        running: true,
        status: "ready",
      },
    });
  });
});
