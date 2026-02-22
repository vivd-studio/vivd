import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  studioMachineProviderMock,
  listStudioMachinesMock,
  getDesiredImageMock,
  getSystemSettingValueMock,
  setSystemSettingValueMock,
  listStudioImagesFromGhcrMock,
  normalizeGhcrRepositoryMock,
  upsertEntitlementMock,
  getProjectEntitlementRowMock,
  ensureContactFormPluginMock,
  ensureAnalyticsPluginMock,
  getTurnstileAutomationIssueMock,
  prepareTurnstileWidgetMock,
  deleteTurnstileWidgetMock,
} = vi.hoisted(() => {
  const listStudioMachinesMock = vi.fn();
  const getDesiredImageMock = vi.fn();
  const reconcileStudioMachinesMock = vi.fn();
  const destroyStudioMachineMock = vi.fn();
  const studioMachineProviderMock: Record<string, unknown> = {
    kind: "fly",
    listStudioMachines: listStudioMachinesMock,
    getDesiredImage: getDesiredImageMock,
    reconcileStudioMachines: reconcileStudioMachinesMock,
    destroyStudioMachine: destroyStudioMachineMock,
  };

  return {
    studioMachineProviderMock,
    listStudioMachinesMock,
    getDesiredImageMock,
    getSystemSettingValueMock: vi.fn(),
    setSystemSettingValueMock: vi.fn(),
    listStudioImagesFromGhcrMock: vi.fn(),
    normalizeGhcrRepositoryMock: vi.fn(),
    upsertEntitlementMock: vi.fn(),
    getProjectEntitlementRowMock: vi.fn(),
    ensureContactFormPluginMock: vi.fn(),
    ensureAnalyticsPluginMock: vi.fn(),
    getTurnstileAutomationIssueMock: vi.fn(),
    prepareTurnstileWidgetMock: vi.fn(),
    deleteTurnstileWidgetMock: vi.fn(),
  };
});

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: studioMachineProviderMock,
}));

vi.mock("../src/services/system/SystemSettingsService", () => ({
  SYSTEM_SETTING_KEYS: {
    studioMachineImageTagOverride: "studio_machine_image_tag_override",
  },
  getSystemSettingValue: getSystemSettingValueMock,
  setSystemSettingValue: setSystemSettingValueMock,
}));

vi.mock("../src/services/studioMachines/fly/ghcr", () => ({
  listStudioImagesFromGhcr: listStudioImagesFromGhcrMock,
  normalizeGhcrRepository: normalizeGhcrRepositoryMock,
}));

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    upsertEntitlement: upsertEntitlementMock,
    listProjectAccess: vi.fn(),
    getProjectEntitlementRow: getProjectEntitlementRowMock,
  },
}));

vi.mock("../src/services/plugins/ProjectPluginService", () => ({
  projectPluginService: {
    ensureContactFormPlugin: ensureContactFormPluginMock,
    ensureAnalyticsPlugin: ensureAnalyticsPluginMock,
  },
}));

vi.mock("../src/services/plugins/contactForm/turnstile", () => ({
  contactFormTurnstileService: {
    getAutomationConfigurationIssue: getTurnstileAutomationIssueMock,
    prepareProjectWidgetCredentials: prepareTurnstileWidgetMock,
    deleteWidget: deleteTurnstileWidgetMock,
  },
}));

vi.mock("../src/auth", () => ({
  auth: {
    api: {
      createUser: vi.fn(),
      signUpEmail: vi.fn(),
    },
  },
}));

vi.mock("../src/db", () => ({
  db: {
    query: {
      user: { findFirst: vi.fn() },
      organization: { findFirst: vi.fn() },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../src/services/usage/LimitsService", () => ({
  limitsService: {
    checkLimits: vi.fn(),
    updateOrganizationLimits: vi.fn(),
  },
}));

vi.mock("../src/services/usage/UsageService", () => ({
  usageService: {
    getCurrentUsage: vi.fn(),
    getUsageHistory: vi.fn(),
    getSessionUsage: vi.fn(),
    getFlowUsage: vi.fn(),
  },
}));

vi.mock("../src/services/publish/DomainService", () => ({
  validateOrganizationSlug: vi.fn(() => ({ valid: true })),
  domainService: {
    createOrganizationDomain: vi.fn(),
    setDomainStatus: vi.fn(),
    setDomainUsage: vi.fn(),
    startDomainVerification: vi.fn(),
    checkDomainVerification: vi.fn(),
    removeDomain: vi.fn(),
    ensureManagedTenantDomainForOrganization: vi.fn(),
  },
}));

import { superAdminRouter } from "../src/trpcRouters/superadmin";

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
        email: "sa@example.com",
        name: "Super Admin",
        role: "super_admin",
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
    organizationRole: null,
    ...overrides,
  };
}

function makeEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    id: "ent-1",
    organizationId: "org-1",
    scope: "project",
    projectSlug: "site-1",
    pluginId: "contact_form",
    state: "enabled",
    managedBy: "manual_superadmin",
    monthlyEventLimit: null,
    hardStop: true,
    turnstileEnabled: false,
    turnstileWidgetId: null,
    turnstileSiteKey: null,
    turnstileSecretKey: null,
    notes: "",
    changedByUserId: "user-1",
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("superadmin router", () => {
  const originalFlyStudioImage = process.env.FLY_STUDIO_IMAGE;

  beforeEach(() => {
    listStudioMachinesMock.mockReset();
    getDesiredImageMock.mockReset();
    getSystemSettingValueMock.mockReset();
    setSystemSettingValueMock.mockReset();
    listStudioImagesFromGhcrMock.mockReset();
    normalizeGhcrRepositoryMock.mockReset();
    upsertEntitlementMock.mockReset();
    getProjectEntitlementRowMock.mockReset();
    ensureContactFormPluginMock.mockReset();
    ensureAnalyticsPluginMock.mockReset();
    getTurnstileAutomationIssueMock.mockReset();
    prepareTurnstileWidgetMock.mockReset();
    deleteTurnstileWidgetMock.mockReset();

    (studioMachineProviderMock as any).kind = "fly";
    listStudioMachinesMock.mockResolvedValue([]);
    getDesiredImageMock.mockResolvedValue("ghcr.io/vivd-studio/vivd-studio:latest");
    getSystemSettingValueMock.mockResolvedValue(null);
    listStudioImagesFromGhcrMock.mockResolvedValue({
      imageBase: "ghcr.io/vivd-studio/vivd-studio",
      images: [
        {
          tag: "v0.1.0",
          kind: "semver",
          version: "0.1.0",
          image: "ghcr.io/vivd-studio/vivd-studio:v0.1.0",
        },
      ],
    });
    normalizeGhcrRepositoryMock.mockReturnValue({
      imageBase: "ghcr.io/vivd-studio/vivd-studio",
    });
    upsertEntitlementMock.mockResolvedValue(makeEntitlement());
    getProjectEntitlementRowMock.mockResolvedValue(null);
    ensureContactFormPluginMock.mockResolvedValue({
      instanceId: "ppi-1",
    });
    ensureAnalyticsPluginMock.mockResolvedValue({
      instanceId: "ppi-analytics-1",
    });
    getTurnstileAutomationIssueMock.mockReturnValue(null);
    prepareTurnstileWidgetMock.mockResolvedValue({
      widgetId: "sitekey-1",
      siteKey: "sitekey-1",
      secretKey: "secret-1",
      domains: ["example.com"],
    });

    delete process.env.FLY_STUDIO_IMAGE;
  });

  afterEach(() => {
    if (typeof originalFlyStudioImage === "string") {
      process.env.FLY_STUDIO_IMAGE = originalFlyStudioImage;
    } else {
      delete process.env.FLY_STUDIO_IMAGE;
    }
  });

  it("returns unsupported machine image options when provider is not fly", async () => {
    (studioMachineProviderMock as any).kind = "local";
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.getStudioMachineImageOptions();

    expect(result).toMatchObject({
      provider: "local",
      supported: false,
      selectionMode: "unsupported",
      desiredImage: null,
      images: [],
    });
  });

  it("returns machine listing errors as payload (not thrown)", async () => {
    (studioMachineProviderMock as any).kind = "fly";
    listStudioMachinesMock.mockRejectedValueOnce(new Error("fly unavailable"));
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.listStudioMachines();

    expect(result).toEqual({
      provider: "fly",
      machines: [],
      error: "fly unavailable",
    });
  });

  it("prefers env override image and surfaces GHCR errors", async () => {
    process.env.FLY_STUDIO_IMAGE = "ghcr.io/vivd-studio/vivd-studio:manual";
    getSystemSettingValueMock.mockResolvedValueOnce("dev-0.3.34");
    listStudioImagesFromGhcrMock.mockRejectedValueOnce(new Error("ghcr down"));
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.getStudioMachineImageOptions();

    expect(result).toMatchObject({
      provider: "fly",
      supported: true,
      selectionMode: "env",
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:manual",
      desiredImageSource: "env",
      overrideTag: "dev-0.3.34",
      error: "ghcr down",
    });
    expect(getDesiredImageMock).not.toHaveBeenCalled();
  });

  it("refuses override-tag updates while FLY_STUDIO_IMAGE is set", async () => {
    process.env.FLY_STUDIO_IMAGE = "ghcr.io/vivd-studio/vivd-studio:manual";
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.setStudioMachineImageOverrideTag({ tag: "dev-0.3.34" });

    expect(result).toMatchObject({
      provider: "fly",
      updated: false,
    });
    expect(String(result.error)).toContain("FLY_STUDIO_IMAGE is set");
    expect(setSystemSettingValueMock).not.toHaveBeenCalled();
  });

  it("ensures a contact-form plugin instance when enabling a project entitlement", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.pluginsUpsertEntitlement({
      pluginId: "contact_form",
      organizationId: "org-1",
      scope: "project",
      projectSlug: "site-1",
      state: "enabled",
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
    expect(ensureContactFormPluginMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
    });
    expect(result.ensuredPluginInstanceId).toBe("ppi-1");
  });

  it("skips plugin ensure when ensurePluginWhenEnabled=false", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.pluginsUpsertEntitlement({
      pluginId: "contact_form",
      organizationId: "org-1",
      scope: "project",
      projectSlug: "site-1",
      state: "enabled",
      ensurePluginWhenEnabled: false,
    });

    expect(ensureContactFormPluginMock).not.toHaveBeenCalled();
    expect(result.ensuredPluginInstanceId).toBeNull();
  });

  it("ensures an analytics plugin instance when enabling analytics for a project", async () => {
    upsertEntitlementMock.mockResolvedValueOnce(
      makeEntitlement({
        pluginId: "analytics",
      }),
    );
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.pluginsUpsertEntitlement({
      pluginId: "analytics",
      organizationId: "org-1",
      scope: "project",
      projectSlug: "site-1",
      state: "enabled",
    });

    expect(ensureAnalyticsPluginMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
    });
    expect(ensureContactFormPluginMock).not.toHaveBeenCalled();
    expect(result.ensuredPluginInstanceId).toBe("ppi-analytics-1");
  });

  it("prepares turnstile widget credentials when enabling turnstile", async () => {
    upsertEntitlementMock.mockResolvedValueOnce(
      makeEntitlement({
        turnstileEnabled: true,
        turnstileWidgetId: "sitekey-1",
        turnstileSiteKey: "sitekey-1",
        turnstileSecretKey: "secret-1",
      }),
    );
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.pluginsUpsertEntitlement({
      pluginId: "contact_form",
      organizationId: "org-1",
      scope: "project",
      projectSlug: "site-1",
      state: "enabled",
      turnstileEnabled: true,
      ensurePluginWhenEnabled: false,
    });

    expect(getTurnstileAutomationIssueMock).toHaveBeenCalled();
    expect(prepareTurnstileWidgetMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      existingWidgetId: null,
      existingSiteKey: null,
      existingSecretKey: null,
    });
    expect(upsertEntitlementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        turnstileEnabled: true,
        turnstileWidgetId: "sitekey-1",
        turnstileSiteKey: "sitekey-1",
        turnstileSecretKey: "secret-1",
      }),
    );
    expect(result.entitlement.turnstileEnabled).toBe(true);
    expect(result.entitlement.turnstileReady).toBe(true);
  });
});
