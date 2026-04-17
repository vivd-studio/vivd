import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensurePluginInstanceMock,
  getPluginInfoContractMock,
  readPluginDataMock,
  requestPluginAccessMock,
  updatePluginConfigByIdMock,
  runPluginActionMock,
  PluginActionArgumentErrorMock,
} = vi.hoisted(() => {
  class PluginActionArgumentError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PluginActionArgumentError";
    }
  }

    return {
      ensurePluginInstanceMock: vi.fn(),
      getPluginInfoContractMock: vi.fn(),
      readPluginDataMock: vi.fn(),
      requestPluginAccessMock: vi.fn(),
      updatePluginConfigByIdMock: vi.fn(),
      runPluginActionMock: vi.fn(),
      PluginActionArgumentErrorMock: PluginActionArgumentError,
  };
});

const {
  resolveEffectiveEntitlementMock,
  getProjectEntitlementRowMock,
  upsertEntitlementMock,
} = vi.hoisted(() => ({
  resolveEffectiveEntitlementMock: vi.fn(),
  getProjectEntitlementRowMock: vi.fn(),
  upsertEntitlementMock: vi.fn(),
}));

const { getPluginInstanceMock } = vi.hoisted(() => ({
  getPluginInstanceMock: vi.fn(),
}));

const {
  preparePluginProjectEntitlementFieldsMock,
  cleanupPluginProjectEntitlementFieldsMock,
} = vi.hoisted(() => ({
  preparePluginProjectEntitlementFieldsMock: vi.fn(),
  cleanupPluginProjectEntitlementFieldsMock: vi.fn(),
}));

const {
  organizationFindFirstMock,
  selectMock,
  selectFromMock,
  selectWhereMock,
} = vi.hoisted(() => {
  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));
  return {
    organizationFindFirstMock: vi.fn(),
    selectMock,
    selectFromMock,
    selectWhereMock,
  };
});

vi.mock("../src/db", () => ({
  db: {
    select: selectMock,
    query: {
      organization: {
        findFirst: organizationFindFirstMock,
      },
    },
  },
}));

vi.mock("../src/services/plugins/ProjectPluginService", () => ({
  projectPluginService: {
    ensurePluginInstance: ensurePluginInstanceMock,
    getPluginInfoContract: getPluginInfoContractMock,
    readPluginData: readPluginDataMock,
    updatePluginConfigById: updatePluginConfigByIdMock,
    runPluginAction: runPluginActionMock,
  },
  PluginActionArgumentError: PluginActionArgumentErrorMock,
  UnsupportedPluginReadError: class UnsupportedPluginReadError extends Error {
    constructor() {
      super("Unsupported plugin read");
      this.name = "UnsupportedPluginReadError";
    }
  },
  UnsupportedPluginActionError: class UnsupportedPluginActionError extends Error {
    constructor() {
      super("Unsupported plugin action");
      this.name = "UnsupportedPluginActionError";
    }
  },
}));

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    resolveEffectiveEntitlement: resolveEffectiveEntitlementMock,
    getProjectEntitlementRow: getProjectEntitlementRowMock,
    upsertEntitlement: upsertEntitlementMock,
  },
}));

vi.mock("../src/services/plugins/integrationHooks", () => ({
  preparePluginProjectEntitlementFields: preparePluginProjectEntitlementFieldsMock,
  cleanupPluginProjectEntitlementFields: cleanupPluginProjectEntitlementFieldsMock,
}));

vi.mock("../src/services/plugins/PluginAccessRequestService", () => ({
  pluginAccessRequestService: {
    requestAccess: requestPluginAccessMock,
  },
}));

vi.mock("../src/services/plugins/core/instanceService", () => ({
  projectPluginInstanceService: {
    getPluginInstance: getPluginInstanceMock,
  },
}));

vi.mock("../src/services/plugins/registry", () => ({
  PLUGIN_IDS: ["contact_form", "analytics", "newsletter", "google_maps"],
  getOptionalPluginModule: vi.fn(() => ({
    mapPublicError: () => null,
  })),
  getPluginModule: vi.fn(() => ({
    mapPublicError: () => null,
  })),
}));

import { router } from "../src/trpc";
import {
  ensurePluginProcedure,
  infoPluginProcedure,
  requestPluginAccessProcedure,
  readPluginProcedure,
  runPluginActionProcedure,
  updatePluginConfigProcedure,
} from "../src/trpcRouters/plugins/generic";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    req: {
      headers: {},
    } as any,
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
        email: "user@example.com",
        name: "User",
        role: "user",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    requestHost: "app.vivd.local",
    requestDomain: "app.vivd.local",
    isSuperAdminHost: true,
    hostKind: "control_plane_host",
    hostOrganizationId: null,
    hostOrganizationSlug: null,
    canSelectOrganization: true,
    organizationId: "org-1",
    organizationRole: "owner",
    ...overrides,
  };
}

describe("plugins.generic router", () => {
  const pluginsRouter = router({
    ensure: ensurePluginProcedure,
    info: infoPluginProcedure,
    requestAccess: requestPluginAccessProcedure,
    read: readPluginProcedure,
    updateConfig: updatePluginConfigProcedure,
    action: runPluginActionProcedure,
  });

  beforeEach(() => {
    ensurePluginInstanceMock.mockReset();
    getPluginInfoContractMock.mockReset();
    readPluginDataMock.mockReset();
    requestPluginAccessMock.mockReset();
    updatePluginConfigByIdMock.mockReset();
    runPluginActionMock.mockReset();
    resolveEffectiveEntitlementMock.mockReset();
    getProjectEntitlementRowMock.mockReset();
    upsertEntitlementMock.mockReset();
    getPluginInstanceMock.mockReset();
    preparePluginProjectEntitlementFieldsMock.mockReset();
    cleanupPluginProjectEntitlementFieldsMock.mockReset();
    organizationFindFirstMock.mockReset();
    selectMock.mockClear();
    selectFromMock.mockClear();
    selectWhereMock.mockReset();

    organizationFindFirstMock.mockResolvedValue({ status: "active" });
    selectWhereMock.mockResolvedValue([]);
    getPluginInstanceMock.mockResolvedValue(null);
    getProjectEntitlementRowMock.mockResolvedValue(null);
    upsertEntitlementMock.mockResolvedValue({});
    preparePluginProjectEntitlementFieldsMock.mockResolvedValue({
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
    });
    cleanupPluginProjectEntitlementFieldsMock.mockResolvedValue(undefined);
    resolveEffectiveEntitlementMock.mockResolvedValue({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
      scope: "project",
      state: "enabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: true,
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
      notes: "",
      changedByUserId: null,
      updatedAt: new Date(),
    });
  });

  it("returns plugin info through the generic info procedure", async () => {
    getPluginInfoContractMock.mockResolvedValueOnce({
      pluginId: "analytics",
      enabled: true,
    });

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.info({ slug: "site-1", pluginId: "analytics" }),
    ).resolves.toMatchObject({
      pluginId: "analytics",
      enabled: true,
    });
    expect(getPluginInfoContractMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
    });
  });

  it("accepts newsletter as a generic plugin id", async () => {
    getPluginInfoContractMock.mockResolvedValueOnce({
      pluginId: "newsletter",
      enabled: true,
    });

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.info({ slug: "site-1", pluginId: "newsletter" }),
    ).resolves.toMatchObject({
      pluginId: "newsletter",
      enabled: true,
    });
    expect(getPluginInfoContractMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "newsletter",
    });
  });

  it("accepts google maps as a generic plugin id", async () => {
    getPluginInfoContractMock.mockResolvedValueOnce({
      pluginId: "google_maps",
      enabled: true,
    });

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.info({ slug: "site-1", pluginId: "google_maps" }),
    ).resolves.toMatchObject({
      pluginId: "google_maps",
      enabled: true,
    });
    expect(getPluginInfoContractMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "google_maps",
    });
  });

  it("rejects generic enable for non-super-admin users", async () => {
    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.ensure({ slug: "site-1", pluginId: "contact_form" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Only super-admin users can enable plugins",
    });
    expect(ensurePluginInstanceMock).not.toHaveBeenCalled();
  });

  it("auto-enables disabled plugins for super-admin users", async () => {
    resolveEffectiveEntitlementMock.mockResolvedValueOnce({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
      scope: "project",
      state: "disabled",
      managedBy: "manual_superadmin",
      monthlyEventLimit: null,
      hardStop: true,
      turnstileEnabled: false,
      turnstileWidgetId: null,
      turnstileSiteKey: null,
      turnstileSecretKey: null,
      notes: "",
      changedByUserId: null,
      updatedAt: new Date(),
    });
    ensurePluginInstanceMock.mockResolvedValueOnce({
      instanceId: "ppi-1",
      created: true,
      status: "enabled",
    });

    const caller = pluginsRouter.createCaller(
      makeContext({
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
            email: "super@example.com",
            name: "Super User",
            role: "super_admin",
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      }),
    );

    await expect(
      caller.ensure({ slug: "site-1", pluginId: "contact_form" }),
    ).resolves.toMatchObject({
      instanceId: "ppi-1",
      status: "enabled",
    });

    expect(preparePluginProjectEntitlementFieldsMock).toHaveBeenCalledWith({
      pluginId: "contact_form",
      organizationId: "org-1",
      projectSlug: "site-1",
      state: "enabled",
      turnstileEnabled: false,
      existingProjectEntitlement: null,
    });
    expect(upsertEntitlementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        scope: "project",
        projectSlug: "site-1",
        pluginId: "contact_form",
        state: "enabled",
        managedBy: "manual_superadmin",
        changedByUserId: "user-1",
      }),
    );
    expect(ensurePluginInstanceMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
    });
  });

  it("sends plugin access requests for non-super-admin project members", async () => {
    requestPluginAccessMock.mockResolvedValueOnce({
      status: "pending",
      requestedAt: "2026-04-17T10:00:00.000Z",
      requestedByUserId: "user-1",
      requesterEmail: "user@example.com",
    });

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.requestAccess({ slug: "site-1", pluginId: "contact_form" }),
    ).resolves.toMatchObject({
      pluginId: "contact_form",
      accessRequest: {
        status: "pending",
      },
    });

    expect(requestPluginAccessMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
      requestedByUserId: "user-1",
      requesterEmail: "user@example.com",
      requesterName: "User",
    });
  });

  it("rejects plugin access requests from super-admin users", async () => {
    const caller = pluginsRouter.createCaller(
      makeContext({
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
            email: "super@example.com",
            name: "Super User",
            role: "super_admin",
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      }),
    );

    await expect(
      caller.requestAccess({ slug: "site-1", pluginId: "contact_form" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Super-admin users can enable plugins directly",
    });
  });

  it("updates config through the generic config procedure", async () => {
    updatePluginConfigByIdMock.mockResolvedValueOnce({
      pluginId: "analytics",
      enabled: true,
      config: { enableClientTracking: true },
    });

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.updateConfig({
        slug: "site-1",
        pluginId: "analytics",
        config: { enableClientTracking: true },
      }),
    ).resolves.toMatchObject({
      pluginId: "analytics",
      enabled: true,
    });
    expect(updatePluginConfigByIdMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
      config: { enableClientTracking: true },
    });
  });

  it("returns plugin data through the generic read procedure", async () => {
    readPluginDataMock.mockResolvedValueOnce({
      pluginId: "analytics",
      readId: "summary",
      result: {
        enabled: true,
      },
    });

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.read({
        slug: "site-1",
        pluginId: "analytics",
        readId: "summary",
        input: { rangeDays: 30 },
      }),
    ).resolves.toMatchObject({
      pluginId: "analytics",
      readId: "summary",
      result: {
        enabled: true,
      },
    });
    expect(readPluginDataMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
      readId: "summary",
      input: { rangeDays: 30 },
    });
  });

  it("maps generic action argument errors to BAD_REQUEST", async () => {
    runPluginActionMock.mockRejectedValueOnce(
      new PluginActionArgumentErrorMock("Plugin action requires an email argument."),
    );

    const caller = pluginsRouter.createCaller(makeContext());

    await expect(
      caller.action({
        slug: "site-1",
        pluginId: "contact_form",
        actionId: "verify_recipient",
        args: [],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Plugin action requires an email argument.",
    });
  });
});
