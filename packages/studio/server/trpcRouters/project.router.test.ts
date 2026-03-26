import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context.js";

const {
  touchMock,
  stopDevServerMock,
  isConnectedModeMock,
  getBackendUrlMock,
  getSessionTokenMock,
  getStudioIdMock,
  getConnectedOrganizationIdMock,
} = vi.hoisted(() => ({
  touchMock: vi.fn(),
  stopDevServerMock: vi.fn(),
  isConnectedModeMock: vi.fn(),
  getBackendUrlMock: vi.fn(),
  getSessionTokenMock: vi.fn(),
  getStudioIdMock: vi.fn(),
  getConnectedOrganizationIdMock: vi.fn(),
}));

vi.mock("../services/project/DevServerService.js", () => ({
  devServerService: {
    touch: touchMock,
    stopDevServer: stopDevServerMock,
    getOrStartDevServer: vi.fn(),
    restartDevServer: vi.fn(),
  },
}));

vi.mock("@vivd/shared", () => ({
  isConnectedMode: isConnectedModeMock,
  getBackendUrl: getBackendUrlMock,
  getSessionToken: getSessionTokenMock,
  getStudioId: getStudioIdMock,
  getConnectedOrganizationId: getConnectedOrganizationIdMock,
}));

import { projectRouter } from "./project.js";

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => "/tmp/workspace"),
    } as unknown as Context["workspace"],
    ...overrides,
  } as Context;
}

describe("project router", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    touchMock.mockReset();
    stopDevServerMock.mockReset();
    isConnectedModeMock.mockReset();
    getBackendUrlMock.mockReset();
    getSessionTokenMock.mockReset();
    getStudioIdMock.mockReset();
    getConnectedOrganizationIdMock.mockReset();

    touchMock.mockReturnValue(undefined);
    stopDevServerMock.mockResolvedValue(undefined);
    isConnectedModeMock.mockReturnValue(false);
    getBackendUrlMock.mockReturnValue("http://backend.local");
    getSessionTokenMock.mockReturnValue("session-token");
    getStudioIdMock.mockReturnValue("studio-1");
    getConnectedOrganizationIdMock.mockReturnValue("org-1");

    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns connected canonical preview URL when backend provides it", async () => {
    isConnectedModeMock.mockReturnValue(true);
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              canonicalUrl: "https://preview.vivd.studio/site-1",
            },
          },
        },
      }),
    });
    const caller = projectRouter.createCaller(makeContext());

    const result = await caller.getShareablePreviewUrl({
      slug: "site-1",
      version: 2,
      origin: "http://app.localhost:3000",
    });

    expect(result).toEqual({ url: "https://preview.vivd.studio/site-1" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/trpc/project.getExternalPreviewStatus?input="),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
          "x-vivd-organization-id": "org-1",
        }),
      }),
    );
  });

  it("falls back to local preview path when connected status has no canonical URL", async () => {
    isConnectedModeMock.mockReturnValue(true);
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              canonicalUrl: "",
            },
          },
        },
      }),
    });
    const caller = projectRouter.createCaller(makeContext());

    const result = await caller.getShareablePreviewUrl({
      slug: "site-1",
      version: 2,
      origin: "http://app.localhost:3000/anything",
    });

    expect(result).toEqual({
      url: "http://app.localhost:3000/vivd-studio/api/preview/site-1/v2/",
    });
  });

  it("returns a relative preview URL when origin is missing or invalid", async () => {
    const caller = projectRouter.createCaller(makeContext());

    await expect(
      caller.getShareablePreviewUrl({
        slug: "site-1",
        version: 2,
      }),
    ).resolves.toEqual({
      url: "/vivd-studio/api/preview/site-1/v2/",
    });

    await expect(
      caller.getShareablePreviewUrl({
        slug: "site-1",
        version: 2,
        origin: "not-a-url",
      }),
    ).resolves.toEqual({
      url: "/vivd-studio/api/preview/site-1/v2/",
    });
  });

  it("includes support email from the runtime env in the project list", async () => {
    const previousSupportEmail = process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL;
    process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = "support@example.com";
    const caller = projectRouter.createCaller(makeContext());

    try {
      await expect(caller.list()).resolves.toEqual({
        supportEmail: "support@example.com",
        projects: [
          expect.objectContaining({
            slug: "studio",
            enabledPlugins: [],
          }),
        ],
      });
    } finally {
      if (typeof previousSupportEmail === "string") {
        process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL = previousSupportEmail;
      } else {
        delete process.env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL;
      }
    }
  });

  it("uses the runtime project slug in the local fallback project list", async () => {
    const previousProjectSlug = process.env.VIVD_PROJECT_SLUG;
    process.env.VIVD_PROJECT_SLUG = "aurora-studio";
    const caller = projectRouter.createCaller(makeContext());

    try {
      await expect(caller.list()).resolves.toEqual({
        supportEmail: null,
        projects: [
          expect.objectContaining({
            slug: "aurora-studio",
            title: "aurora-studio",
          }),
        ],
      });
    } finally {
      if (typeof previousProjectSlug === "string") {
        process.env.VIVD_PROJECT_SLUG = previousProjectSlug;
      } else {
        delete process.env.VIVD_PROJECT_SLUG;
      }
    }
  });

  it("prefers live connected backend project data for plugin state", async () => {
    const previousProjectSlug = process.env.VIVD_PROJECT_SLUG;
    process.env.VIVD_PROJECT_SLUG = "aurora-studio";
    isConnectedModeMock.mockReturnValue(true);
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              supportEmail: "support@example.com",
            },
          },
        },
      }),
    });
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              projects: [
                {
                  slug: "aurora-studio",
                  status: "completed",
                  url: null,
                  source: "scratch",
                  title: "Aurora Studio",
                  createdAt: "2026-03-24T10:00:00.000Z",
                  updatedAt: "2026-03-24T10:00:00.000Z",
                  currentVersion: 3,
                  totalVersions: 3,
                  versions: [{ version: 3, status: "completed" }],
                  publishedDomain: null,
                  publishedVersion: null,
                  thumbnailUrl: null,
                  enabledPlugins: ["analytics"],
                },
              ],
            },
          },
        },
      }),
    });
    const caller = projectRouter.createCaller(makeContext());

    try {
      await expect(caller.list()).resolves.toEqual({
        supportEmail: "support@example.com",
        projects: [
          expect.objectContaining({
            slug: "aurora-studio",
            currentVersion: 3,
            enabledPlugins: ["analytics"],
          }),
        ],
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/trpc/config.getAppConfig?input="),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer session-token",
            "x-vivd-organization-id": "org-1",
          }),
        }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/trpc/project.list?input="),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer session-token",
            "x-vivd-organization-id": "org-1",
          }),
        }),
      );
    } finally {
      if (typeof previousProjectSlug === "string") {
        process.env.VIVD_PROJECT_SLUG = previousProjectSlug;
      } else {
        delete process.env.VIVD_PROJECT_SLUG;
      }
    }
  });

  it("touches the dev server only when workspace is initialized", async () => {
    const readyCaller = projectRouter.createCaller(makeContext());
    const notReadyCaller = projectRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => false),
          getProjectPath: vi.fn(),
        } as unknown as Context["workspace"],
      }),
    );

    await expect(
      readyCaller.keepAliveDevServer({ slug: "site-1", version: 2 }),
    ).resolves.toEqual({ success: true });
    await expect(
      notReadyCaller.keepAliveDevServer({ slug: "site-1", version: 2 }),
    ).resolves.toEqual({ success: false });

    expect(touchMock).toHaveBeenCalledTimes(1);
  });

  it("stops the dev server only when workspace is initialized", async () => {
    const readyCaller = projectRouter.createCaller(makeContext());
    const notReadyCaller = projectRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => false),
          getProjectPath: vi.fn(),
        } as unknown as Context["workspace"],
      }),
    );

    await expect(
      readyCaller.stopDevServer({ slug: "site-1", version: 2 }),
    ).resolves.toEqual({ success: true });
    await expect(
      notReadyCaller.stopDevServer({ slug: "site-1", version: 2 }),
    ).resolves.toEqual({ success: false });

    expect(stopDevServerMock).toHaveBeenCalledTimes(1);
    expect(stopDevServerMock).toHaveBeenCalledWith({ reason: "api-stop" });
  });
});
