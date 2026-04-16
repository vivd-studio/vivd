import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureRunningMock,
  restartMock,
  recordStudioVisitMock,
  getResolvedBrandingMock,
  projectPluginFindManyMock,
  organizationFindFirstMock,
  resolvePolicyMock,
  dbSelectMock,
  dbSelectFromMock,
  dbSelectWhereMock,
} = vi.hoisted(() => {
  const ensureRunningMock = vi.fn();
  const restartMock = vi.fn();
  const recordStudioVisitMock = vi.fn();
  const getResolvedBrandingMock = vi.fn();
  const projectPluginFindManyMock = vi.fn();
  const organizationFindFirstMock = vi.fn();
  const resolvePolicyMock = vi.fn();
  const dbSelectWhereMock = vi.fn().mockResolvedValue([]);
  const dbSelectFromMock = vi.fn(() => ({ where: dbSelectWhereMock }));
  const dbSelectMock = vi.fn(() => ({ from: dbSelectFromMock }));

  return {
    ensureRunningMock,
    restartMock,
    recordStudioVisitMock,
    getResolvedBrandingMock,
    projectPluginFindManyMock,
    organizationFindFirstMock,
    resolvePolicyMock,
    dbSelectMock,
    dbSelectFromMock,
    dbSelectWhereMock,
  };
});

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: {
    kind: "fly",
    ensureRunning: ensureRunningMock,
    restart: restartMock,
    getUrl: vi.fn(),
    stop: vi.fn(),
    touch: vi.fn(),
    isRunning: vi.fn(),
  },
}));

vi.mock("../src/services/studioMachines/visitStore", () => ({
  recordStudioVisit: recordStudioVisitMock,
}));

vi.mock("../src/services/system/InstallProfileService", () => ({
  installProfileService: {
    resolvePolicy: resolvePolicyMock,
  },
}));

vi.mock("../src/services/email/templateBranding", () => ({
  emailTemplateBrandingService: {
    getResolvedBranding: getResolvedBrandingMock,
  },
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      projectPluginInstance: { findMany: projectPluginFindManyMock },
      organization: { findFirst: organizationFindFirstMock },
    },
    select: dbSelectMock,
  },
}));

import { router } from "../src/trpc";
import { studioProcedures } from "../src/trpcRouters/project/studio";

const studioRouter = router({
  startStudio: studioProcedures.startStudio,
  hardRestartStudio: studioProcedures.hardRestartStudio,
});

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: {} as any,
    res: {} as any,
    session: {
      session: {
        id: "sess-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
        role: "super_admin",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    requestHost: "felixpahlke.vivd.studio",
    requestProtocol: "https",
    requestDomain: "felixpahlke.vivd.studio",
    isSuperAdminHost: true,
    hostKind: "tenant_host",
    hostOrganizationId: "org-felix",
    hostOrganizationSlug: "felixpahlke",
    canSelectOrganization: false,
    organizationId: "org-felix",
    organizationRole: "owner",
    ...overrides,
  };
}

describe("project studio callback URL wiring", () => {
  const envSnapshot = {
    BACKEND_URL: process.env.BACKEND_URL,
    DOMAIN: process.env.DOMAIN,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    PORT: process.env.PORT,
  };

  beforeEach(() => {
    ensureRunningMock.mockReset();
    restartMock.mockReset();
    recordStudioVisitMock.mockReset();
    getResolvedBrandingMock.mockReset();
    projectPluginFindManyMock.mockReset();
    organizationFindFirstMock.mockReset();
    resolvePolicyMock.mockReset();
    dbSelectMock.mockClear();
    dbSelectFromMock.mockClear();
    dbSelectWhereMock.mockClear();

    process.env.BACKEND_URL = "https://default.vivd.studio";
    process.env.DOMAIN = "https://default.vivd.studio";
    process.env.BETTER_AUTH_URL = "https://default.vivd.studio";
    process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
    process.env.PORT = "3000";

    projectPluginFindManyMock.mockResolvedValue([]);
    getResolvedBrandingMock.mockResolvedValue({ supportEmail: null });
    organizationFindFirstMock.mockResolvedValue({ githubRepoPrefix: null });
    resolvePolicyMock.mockResolvedValue({
      controlPlane: { mode: "host_based" },
    });
    recordStudioVisitMock.mockResolvedValue(undefined);
    ensureRunningMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://studio.example",
      port: 3100,
      accessToken: "access-1",
    });
    restartMock.mockResolvedValue({
      studioId: "studio-1",
      url: "https://studio.example",
      port: 3100,
      accessToken: "access-1",
    });
  });

  afterAll(() => {
    process.env.BACKEND_URL = envSnapshot.BACKEND_URL;
    process.env.DOMAIN = envSnapshot.DOMAIN;
    process.env.BETTER_AUTH_URL = envSnapshot.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_SECRET = envSnapshot.BETTER_AUTH_SECRET;
    process.env.PORT = envSnapshot.PORT;
  });

  it("startStudio uses canonical callback URL for fly machines", async () => {
    const caller = studioRouter.createCaller(makeContext());

    const result = await caller.startStudio({ slug: "site-1", version: 1 });

    expect(result).toMatchObject({ success: true });
    expect(result.userActionToken).toMatch(/^v1\./);
    expect(ensureRunningMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-felix",
        projectSlug: "site-1",
        version: 1,
        env: expect.objectContaining({
          MAIN_BACKEND_URL: "https://default.vivd.studio/vivd-studio",
        }),
      }),
    );
    expect(ensureRunningMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.not.objectContaining({
          VIVD_ORGANIZATION_ROLE: expect.anything(),
        }),
      }),
    );
  });

  it("hardRestartStudio uses canonical callback URL for fly machines", async () => {
    const caller = studioRouter.createCaller(makeContext());

    const result = await caller.hardRestartStudio({ slug: "site-1", version: 1 });

    expect(result).toMatchObject({ success: true });
    expect(result.userActionToken).toMatch(/^v1\./);
    expect(restartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-felix",
        projectSlug: "site-1",
        version: 1,
        mode: "hard",
        env: expect.objectContaining({
          MAIN_BACKEND_URL: "https://default.vivd.studio/vivd-studio",
        }),
      }),
    );
  });

  it("startStudio sorts enabled plugins before writing machine env", async () => {
    projectPluginFindManyMock.mockResolvedValue([
      { pluginId: "seo" },
      { pluginId: "analytics" },
      { pluginId: "contact_form" },
    ]);

    const caller = studioRouter.createCaller(makeContext());

    const result = await caller.startStudio({ slug: "site-1", version: 1 });

    expect(result).toMatchObject({ success: true });
    expect(ensureRunningMock).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          VIVD_ENABLED_PLUGINS: "analytics,contact_form,seo",
        }),
      }),
    );
  });

  it("returns a direct browser URL for platform installs even when a compatibility route exists", async () => {
    ensureRunningMock.mockResolvedValueOnce({
      studioId: "studio-1",
      url: "https://vivd-studio-prod.fly.dev:3115",
      runtimeUrl: "https://vivd-studio-prod.fly.dev:3115",
      compatibilityUrl: "/_studio/runtime-1",
      port: 3115,
      accessToken: "access-1",
    });

    const caller = studioRouter.createCaller(makeContext());
    const result = await caller.startStudio({ slug: "site-1", version: 1 });

    expect(result).toMatchObject({
      success: true,
      url: "https://vivd-studio-prod.fly.dev:3115",
      browserUrl: "https://vivd-studio-prod.fly.dev:3115",
      runtimeUrl: "https://vivd-studio-prod.fly.dev:3115",
      compatibilityUrl: "/_studio/runtime-1",
    });
  });

  it("returns the direct browser URL for local platform hosts", async () => {
    resolvePolicyMock.mockResolvedValueOnce({
      controlPlane: { mode: "host_based" },
    });
    ensureRunningMock.mockResolvedValueOnce({
      studioId: "studio-1",
      url: "http://app.localhost:4100",
      runtimeUrl: "http://app.localhost:4100",
      compatibilityUrl: "http://app.localhost:18080/_studio/runtime-1",
      port: 4100,
      accessToken: "access-1",
    });

    const caller = studioRouter.createCaller(
      makeContext({
        req: {
          headers: {
            "x-forwarded-host": "app.localhost:18080",
            "x-forwarded-proto": "http",
          },
        } as any,
        requestHost: "app.localhost",
        requestProtocol: "http",
        requestDomain: "app.localhost",
      }),
    );
    const result = await caller.startStudio({ slug: "site-1", version: 1 });

    expect(result).toMatchObject({
      success: true,
      url: "http://app.localhost:4100",
      browserUrl: "http://app.localhost:4100",
      runtimeUrl: "http://app.localhost:4100",
      compatibilityUrl: "http://app.localhost:18080/_studio/runtime-1",
    });
  });

  it("returns the compatibility browser URL for solo installs that need same-host routing", async () => {
    resolvePolicyMock.mockResolvedValueOnce({
      controlPlane: { mode: "path_based" },
    });
    ensureRunningMock.mockResolvedValueOnce({
      studioId: "studio-1",
      url: "https://vivd.felixpahlke.de:4100",
      runtimeUrl: "https://vivd.felixpahlke.de:4100",
      compatibilityUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
      port: 4100,
      accessToken: "access-1",
    });

    const caller = studioRouter.createCaller(
      makeContext({
        requestHost: "vivd.felixpahlke.de",
        requestProtocol: "https",
        requestDomain: "vivd.felixpahlke.de",
      }),
    );
    const result = await caller.startStudio({ slug: "site-1", version: 1 });

    expect(result).toMatchObject({
      success: true,
      url: "https://vivd.felixpahlke.de/_studio/runtime-1",
      browserUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
      runtimeUrl: "https://vivd.felixpahlke.de:4100",
      compatibilityUrl: "https://vivd.felixpahlke.de/_studio/runtime-1",
    });
  });
});
