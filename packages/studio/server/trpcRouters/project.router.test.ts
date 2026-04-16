import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context.js";

const {
  touchMock,
  stopDevServerMock,
  getOrStartDevServerMock,
  isConnectedModeMock,
  getBackendUrlMock,
  getStudioIdMock,
  getConnectedOrganizationIdMock,
  detectProjectTypeMock,
  getConnectedUserActionAuthConfigMock,
  reportSoonMock,
} = vi.hoisted(() => ({
  touchMock: vi.fn(),
  stopDevServerMock: vi.fn(),
  getOrStartDevServerMock: vi.fn(),
  isConnectedModeMock: vi.fn(),
  getBackendUrlMock: vi.fn(),
  getStudioIdMock: vi.fn(),
  getConnectedOrganizationIdMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
  getConnectedUserActionAuthConfigMock: vi.fn(),
  reportSoonMock: vi.fn(),
}));

vi.mock("../services/project/DevServerService.js", () => ({
  devServerService: {
    touch: touchMock,
    stopDevServer: stopDevServerMock,
    getOrStartDevServer: getOrStartDevServerMock,
    hasServer: vi.fn(() => false),
    restartDevServer: vi.fn(),
  },
}));

vi.mock("../services/project/projectType.js", () => ({
  detectProjectType: detectProjectTypeMock,
}));

vi.mock("../services/reporting/WorkspaceStateReporter.js", () => ({
  workspaceStateReporter: {
    reportSoon: reportSoonMock,
  },
}));

vi.mock("../lib/connectedUserActionAuth.js", () => ({
  getConnectedUserActionAuthConfig: getConnectedUserActionAuthConfigMock,
  buildConnectedUserActionHeaders: (
    config: {
      userActionToken: string;
      organizationId?: string;
    },
    options?: { includeContentType?: boolean },
  ) => {
    const headers: Record<string, string> = {};
    if (options?.includeContentType !== false) {
      headers["Content-Type"] = "application/json";
    }
    headers["x-vivd-studio-user-action-token"] = config.userActionToken;
    if (config.organizationId) {
      headers["x-vivd-organization-id"] = config.organizationId;
    }
    return headers;
  },
}));

vi.mock("@vivd/shared", () => ({
  isConnectedMode: isConnectedModeMock,
  getBackendUrl: getBackendUrlMock,
  getStudioId: getStudioIdMock,
  getConnectedOrganizationId: getConnectedOrganizationIdMock,
}));

import { projectRouter } from "./project.js";

function makeContext(overrides: Partial<Context> = {}): Context {
  const headers: Record<string, string> = {
    cookie: "vivd_studio_user_action_token=user-action-token-1",
  };

  return {
    workspace: {
      isInitialized: vi.fn(() => true),
      getProjectPath: vi.fn(() => "/tmp/workspace"),
    } as unknown as Context["workspace"],
    req: {
      headers,
      get(name: string) {
        return headers[name.toLowerCase()];
      },
    } as unknown as Context["req"],
    ...overrides,
  } as Context;
}

describe("project router", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    touchMock.mockReset();
    stopDevServerMock.mockReset();
    getOrStartDevServerMock.mockReset();
    isConnectedModeMock.mockReset();
    getBackendUrlMock.mockReset();
    getStudioIdMock.mockReset();
    getConnectedOrganizationIdMock.mockReset();
    detectProjectTypeMock.mockReset();
    getConnectedUserActionAuthConfigMock.mockReset();
    reportSoonMock.mockReset();

    touchMock.mockReturnValue(undefined);
    stopDevServerMock.mockResolvedValue(undefined);
    getOrStartDevServerMock.mockResolvedValue({
      url: null,
      status: "starting",
    });
    isConnectedModeMock.mockReturnValue(false);
    getBackendUrlMock.mockReturnValue("http://backend.local");
    getStudioIdMock.mockReturnValue("studio-1");
    getConnectedOrganizationIdMock.mockReturnValue("org-1");
    detectProjectTypeMock.mockReturnValue({
      mode: "static",
      packageManager: "npm",
      framework: "generic",
    });
    getConnectedUserActionAuthConfigMock.mockReturnValue({
      backendUrl: "http://backend.local",
      studioId: "studio-1",
      organizationId: "org-1",
      userActionToken: "user-action-token-1",
    });

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
          "x-vivd-studio-user-action-token": "user-action-token-1",
          "x-vivd-organization-id": "org-1",
        }),
      }),
    );
  });

  it("proxies publish target discovery in connected mode", async () => {
    isConnectedModeMock.mockReturnValue(true);
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          data: {
            json: {
              projectSlug: "site-1",
              currentPublishedDomain: null,
              recommendedDomain: "acme.vivd.studio",
              targets: [
                {
                  domain: "acme.vivd.studio",
                  usage: "tenant_host",
                  type: "managed_subdomain",
                  status: "active",
                  current: false,
                  primaryHost: false,
                  available: true,
                  url: "https://acme.vivd.studio",
                  recommended: true,
                },
              ],
            },
          },
        },
      }),
    });
    const caller = projectRouter.createCaller(makeContext());

    const result = await caller.publishTargets({ slug: "site-1" });

    expect(result).toEqual({
      projectSlug: "site-1",
      currentPublishedDomain: null,
      recommendedDomain: "acme.vivd.studio",
      targets: [
        {
          domain: "acme.vivd.studio",
          usage: "tenant_host",
          type: "managed_subdomain",
          status: "active",
          current: false,
          primaryHost: false,
          available: true,
          url: "https://acme.vivd.studio",
          recommended: true,
        },
      ],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/trpc/project.publishTargets?input="),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-vivd-studio-user-action-token": "user-action-token-1",
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

  it("returns only an actively pinned working commit", async () => {
    const caller = projectRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => true),
          getProjectPath: vi.fn(() => "/tmp/workspace"),
          getWorkingCommit: vi.fn(async () => null),
          getHeadCommit: vi.fn(async () => ({ hash: "head-123" })),
        } as unknown as Context["workspace"],
      }),
    );

    await expect(
      caller.gitWorkingCommit({ slug: "site-1", version: 2 }),
    ).resolves.toEqual({ hash: null });
  });

  it("uses the explicit load-latest path instead of loading HEAD as an older snapshot", async () => {
    const loadLatestMock = vi.fn(async () => undefined);
    const caller = projectRouter.createCaller(
      makeContext({
        workspace: {
          isInitialized: vi.fn(() => true),
          getProjectPath: vi.fn(() => "/tmp/workspace"),
          loadLatest: loadLatestMock,
        } as unknown as Context["workspace"],
      }),
    );

    await expect(
      caller.gitLoadLatest({ slug: "site-1", version: 2 }),
    ).resolves.toEqual({
      success: true,
      message: "Returned to the latest snapshot",
    });

    expect(loadLatestMock).toHaveBeenCalledTimes(1);
    expect(reportSoonMock).toHaveBeenCalledTimes(1);
  });

  it("returns the runtime root for static preview info", async () => {
    detectProjectTypeMock.mockReturnValue({
      mode: "static",
      packageManager: "npm",
      framework: "generic",
    });

    const caller = projectRouter.createCaller(makeContext());
    await expect(
      caller.getPreviewInfo({
        slug: "site-1",
        version: 2,
      }),
    ).resolves.toEqual({
      mode: "static",
      status: "ready",
      url: "/",
    });
  });

  it("starts dev preview on the runtime root", async () => {
    detectProjectTypeMock.mockReturnValue({
      mode: "devserver",
      devCommand: "npm run dev",
      packageManager: "npm",
      framework: "generic",
    });
    getOrStartDevServerMock.mockResolvedValue({
      url: null,
      status: "starting",
      error: undefined,
    });

    const caller = projectRouter.createCaller(makeContext());
    await expect(
      caller.getPreviewInfo({
        slug: "site-1",
        version: 2,
      }),
    ).resolves.toEqual({
      mode: "devserver",
      status: "starting",
      url: "/",
      error: undefined,
    });
    expect(getOrStartDevServerMock).toHaveBeenCalledWith("/tmp/workspace", "/");
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
            "x-vivd-studio-user-action-token": "user-action-token-1",
            "x-vivd-organization-id": "org-1",
          }),
        }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/trpc/project.list?input="),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-vivd-studio-user-action-token": "user-action-token-1",
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
