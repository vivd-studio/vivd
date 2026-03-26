import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  studioMachineProviderMock,
  listStudioMachinesMock,
  getDesiredImageMock,
  invalidateDesiredImageCacheMock,
  reconcileStudioMachinesMock,
  reconcileStudioMachineMock,
  parkStudioMachineMock,
  destroyStudioMachineMock,
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
  getDefaultTemplateMock,
  resolvePolicyMock,
  updateInstallProfileMock,
  updateInstanceCapabilityPolicyMock,
  updateInstancePluginDefaultsMock,
  updateInstanceLimitDefaultsMock,
  getResolvedNetworkSettingsMock,
  updateStoredNetworkSettingsMock,
  syncSelfHostedCaddyConfigMock,
  reloadCaddyConfigMock,
  syncGeneratedCaddyConfigsMock,
} = vi.hoisted(() => {
  const listStudioMachinesMock = vi.fn();
  const getDesiredImageMock = vi.fn();
  const reconcileStudioMachinesMock = vi.fn();
  const reconcileStudioMachineMock = vi.fn();
  const parkStudioMachineMock = vi.fn();
  const destroyStudioMachineMock = vi.fn();
  const invalidateDesiredImageCacheMock = vi.fn();
  const studioMachineProviderMock: Record<string, unknown> = {
    kind: "fly",
    listStudioMachines: listStudioMachinesMock,
    getDesiredImage: getDesiredImageMock,
    invalidateDesiredImageCache: invalidateDesiredImageCacheMock,
    reconcileStudioMachines: reconcileStudioMachinesMock,
    reconcileStudioMachine: reconcileStudioMachineMock,
    parkStudioMachine: parkStudioMachineMock,
    destroyStudioMachine: destroyStudioMachineMock,
  };

  return {
    studioMachineProviderMock,
    listStudioMachinesMock,
    getDesiredImageMock,
    invalidateDesiredImageCacheMock,
    reconcileStudioMachinesMock,
    reconcileStudioMachineMock,
    parkStudioMachineMock,
    destroyStudioMachineMock,
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
    getDefaultTemplateMock: vi.fn(),
    resolvePolicyMock: vi.fn(),
    updateInstallProfileMock: vi.fn(),
    updateInstanceCapabilityPolicyMock: vi.fn(),
    updateInstancePluginDefaultsMock: vi.fn(),
    updateInstanceLimitDefaultsMock: vi.fn(),
    getResolvedNetworkSettingsMock: vi.fn(),
    updateStoredNetworkSettingsMock: vi.fn(),
    syncSelfHostedCaddyConfigMock: vi.fn(),
    reloadCaddyConfigMock: vi.fn(),
    syncGeneratedCaddyConfigsMock: vi.fn(),
  };
});

vi.mock("../src/services/studioMachines", () => ({
  studioMachineProvider: studioMachineProviderMock,
}));

vi.mock("../src/services/system/SystemSettingsService", () => ({
  SYSTEM_SETTING_KEYS: {
    studioMachineImageTagOverride: "studio_machine_image_tag_override",
    studioAgentInstructionsTemplate: "studio_agent_instructions_template",
  },
  getSystemSettingValue: getSystemSettingValueMock,
  setSystemSettingValue: setSystemSettingValueMock,
}));

vi.mock("../src/services/agent/AgentInstructionsService", () => ({
  agentInstructionsService: {
    getDefaultTemplate: getDefaultTemplateMock,
  },
}));

vi.mock("../src/services/system/InstallProfileService", async () => {
  const { z } = await import("zod");
  return {
    installProfileSchema: z.enum(["solo", "platform"]),
    partialInstanceCapabilityPolicySchema: z
      .object({
        multiOrg: z.boolean(),
        tenantHosts: z.boolean(),
        customDomains: z.boolean(),
        orgLimitOverrides: z.boolean(),
        orgPluginEntitlements: z.boolean(),
        projectPluginEntitlements: z.boolean(),
        dedicatedPluginHost: z.boolean(),
      })
      .partial(),
    instancePluginDefaultsSchema: z
      .object({
        contact_form: z.object({ enabled: z.boolean().optional() }).optional(),
        analytics: z.object({ enabled: z.boolean().optional() }).optional(),
      })
      .strict(),
    instanceLimitDefaultsSchema: z
      .object({
        dailyCreditLimit: z.number().nonnegative().optional(),
        weeklyCreditLimit: z.number().nonnegative().optional(),
        monthlyCreditLimit: z.number().nonnegative().optional(),
        imageGenPerMonth: z.number().int().nonnegative().optional(),
        warningThreshold: z.number().min(0.1).max(1).optional(),
        maxProjects: z.number().int().nonnegative().optional(),
      })
      .strict(),
    installProfileService: {
      resolvePolicy: resolvePolicyMock,
      updateInstallProfile: updateInstallProfileMock,
      updateInstanceCapabilityPolicy: updateInstanceCapabilityPolicyMock,
      updateInstancePluginDefaults: updateInstancePluginDefaultsMock,
      updateInstanceLimitDefaults: updateInstanceLimitDefaultsMock,
    },
  };
});

vi.mock("../src/services/system/InstanceNetworkSettingsService", async () => {
  const { z } = await import("zod");
  return {
    instanceTlsModeSchema: z.enum(["managed", "external", "off"]),
    instanceNetworkSettingsService: {
      getResolvedSettings: getResolvedNetworkSettingsMock,
      updateStoredSettings: updateStoredNetworkSettingsMock,
      syncSelfHostedCaddyConfig: syncSelfHostedCaddyConfigMock,
    },
  };
});

vi.mock("../src/services/system/CaddyAdminService", () => ({
  reloadCaddyConfig: reloadCaddyConfigMock,
}));

vi.mock("../src/services/publish/PublishService", () => ({
  publishService: {
    syncGeneratedCaddyConfigs: syncGeneratedCaddyConfigsMock,
  },
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
  const originalDockerStudioImage = process.env.DOCKER_STUDIO_IMAGE;

  beforeEach(() => {
    listStudioMachinesMock.mockReset();
    getDesiredImageMock.mockReset();
    invalidateDesiredImageCacheMock.mockReset();
    reconcileStudioMachinesMock.mockReset();
    reconcileStudioMachineMock.mockReset();
    parkStudioMachineMock.mockReset();
    destroyStudioMachineMock.mockReset();
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
    getDefaultTemplateMock.mockReset();
    resolvePolicyMock.mockReset();
    updateInstallProfileMock.mockReset();
    updateInstanceCapabilityPolicyMock.mockReset();
    updateInstancePluginDefaultsMock.mockReset();
    updateInstanceLimitDefaultsMock.mockReset();
    getResolvedNetworkSettingsMock.mockReset();
    updateStoredNetworkSettingsMock.mockReset();
    syncSelfHostedCaddyConfigMock.mockReset();
    reloadCaddyConfigMock.mockReset();
    syncGeneratedCaddyConfigsMock.mockReset();

    (studioMachineProviderMock as any).kind = "fly";
    listStudioMachinesMock.mockResolvedValue([]);
    getDesiredImageMock.mockResolvedValue("ghcr.io/vivd-studio/vivd-studio:latest");
    reconcileStudioMachinesMock.mockResolvedValue({
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:latest",
      scanned: 0,
      warmedOutdatedImages: 0,
      destroyedOldMachines: 0,
      skippedRunningMachines: 0,
      dryRun: false,
      errors: [],
    });
    reconcileStudioMachineMock.mockResolvedValue({
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:latest",
    });
    parkStudioMachineMock.mockResolvedValue("suspended");
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
    getDefaultTemplateMock.mockReturnValue("default template");
    getResolvedNetworkSettingsMock.mockReturnValue({
      publicHost: "app.vivd.local",
      publicOrigin: "https://app.vivd.local",
      tlsMode: "external",
      acmeEmail: null,
      sources: {
        publicHost: "bootstrap_env",
        tlsMode: "bootstrap_env",
        acmeEmail: "default",
      },
      deploymentManaged: {
        publicHost: false,
      },
    });
    updateStoredNetworkSettingsMock.mockResolvedValue(undefined);
    syncSelfHostedCaddyConfigMock.mockResolvedValue(false);
    reloadCaddyConfigMock.mockResolvedValue(undefined);
    syncGeneratedCaddyConfigsMock.mockResolvedValue(undefined);
    resolvePolicyMock.mockResolvedValue({
      installProfile: "platform",
      singleProjectMode: false,
      capabilities: {
        multiOrg: true,
        tenantHosts: true,
        customDomains: true,
        orgLimitOverrides: true,
        orgPluginEntitlements: true,
        projectPluginEntitlements: true,
        dedicatedPluginHost: true,
      },
      pluginDefaults: {
        contact_form: {
          pluginId: "contact_form",
          state: "disabled",
          managedBy: "manual_superadmin",
        },
        analytics: {
          pluginId: "analytics",
          state: "disabled",
          managedBy: "manual_superadmin",
        },
      },
      limitDefaults: {},
      controlPlane: { mode: "host_based" },
      pluginRuntime: { mode: "dedicated_host" },
    });

    delete process.env.FLY_STUDIO_IMAGE;
    delete process.env.DOCKER_STUDIO_IMAGE;
  });

  afterEach(() => {
    if (typeof originalFlyStudioImage === "string") {
      process.env.FLY_STUDIO_IMAGE = originalFlyStudioImage;
    } else {
      delete process.env.FLY_STUDIO_IMAGE;
    }

    if (typeof originalDockerStudioImage === "string") {
      process.env.DOCKER_STUDIO_IMAGE = originalDockerStudioImage;
    } else {
      delete process.env.DOCKER_STUDIO_IMAGE;
    }
  });

  it("returns unsupported machine image options when provider is not managed", async () => {
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

  it("rejects network updates while the effective install profile is platform", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(
      caller.updateInstanceSettings({
        network: {
          publicHost: "example.com",
          tlsMode: "external",
        },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Instance network settings are currently UI-managed only for solo installs.",
    });

    expect(updateStoredNetworkSettingsMock).not.toHaveBeenCalled();
    expect(syncGeneratedCaddyConfigsMock).not.toHaveBeenCalled();
  });

  it("allows network updates when switching to solo in the same mutation", async () => {
    resolvePolicyMock
      .mockResolvedValueOnce({
        installProfile: "platform",
        singleProjectMode: false,
        capabilities: {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        },
        pluginDefaults: {
          contact_form: {
            pluginId: "contact_form",
            state: "disabled",
            managedBy: "manual_superadmin",
          },
          analytics: {
            pluginId: "analytics",
            state: "disabled",
            managedBy: "manual_superadmin",
          },
        },
        limitDefaults: {},
        controlPlane: { mode: "host_based" },
        pluginRuntime: { mode: "dedicated_host" },
      })
      .mockResolvedValueOnce({
        installProfile: "solo",
        singleProjectMode: true,
        capabilities: {
          multiOrg: false,
          tenantHosts: false,
          customDomains: false,
          orgLimitOverrides: false,
          orgPluginEntitlements: false,
          projectPluginEntitlements: true,
          dedicatedPluginHost: false,
        },
        pluginDefaults: {
          contact_form: {
            pluginId: "contact_form",
            state: "enabled",
            managedBy: "install_profile_default",
          },
          analytics: {
            pluginId: "analytics",
            state: "enabled",
            managedBy: "install_profile_default",
          },
        },
        limitDefaults: {},
        controlPlane: { mode: "path_based" },
        pluginRuntime: { mode: "same_host_path" },
      });

    const caller = superAdminRouter.createCaller(makeContext());

    await caller.updateInstanceSettings({
      installProfile: "solo",
      network: {
        publicHost: "example.com",
        tlsMode: "managed",
        acmeEmail: "admin@example.com",
      },
    });

    expect(updateInstallProfileMock).toHaveBeenCalledWith("solo");
    expect(updateStoredNetworkSettingsMock).toHaveBeenCalledWith({
      publicHost: "example.com",
      tlsMode: "managed",
      acmeEmail: "admin@example.com",
    });
    expect(syncGeneratedCaddyConfigsMock).toHaveBeenCalledTimes(1);
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

  it("supports docker image overrides via docker env vars", async () => {
    (studioMachineProviderMock as any).kind = "docker";
    process.env.DOCKER_STUDIO_IMAGE = "ghcr.io/vivd-studio/vivd-studio:docker-manual";
    getSystemSettingValueMock.mockResolvedValueOnce("dev-0.3.34");
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.getStudioMachineImageOptions();

    expect(result).toMatchObject({
      provider: "docker",
      supported: true,
      selectionMode: "env",
      envOverrideVarName: "DOCKER_STUDIO_IMAGE",
      envOverrideImage: "ghcr.io/vivd-studio/vivd-studio:docker-manual",
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:docker-manual",
      desiredImageSource: "env",
      overrideTag: "dev-0.3.34",
    });
    expect(getDesiredImageMock).not.toHaveBeenCalled();
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

  it("uses provider desired image for effective desiredImage", async () => {
    getDesiredImageMock.mockResolvedValueOnce("ghcr.io/vivd-studio/vivd-studio:0.5.4");
    listStudioImagesFromGhcrMock.mockResolvedValueOnce({
      imageBase: "ghcr.io/vivd-studio/vivd-studio",
      images: [
        {
          tag: "0.6.0",
          kind: "semver",
          version: "0.6.0",
          image: "ghcr.io/vivd-studio/vivd-studio:0.6.0",
        },
      ],
    });
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.getStudioMachineImageOptions();

    expect(result).toMatchObject({
      provider: "fly",
      supported: true,
      selectionMode: "latest",
      desiredImage: "ghcr.io/vivd-studio/vivd-studio:0.5.4",
      desiredImageSource: "fallback",
      latestImage: "ghcr.io/vivd-studio/vivd-studio:0.6.0",
    });
    expect(listStudioImagesFromGhcrMock).toHaveBeenCalledWith(
      expect.objectContaining({
        semverLimit: 12,
        devLimit: 25,
      }),
    );
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

  it("returns default agent instructions template when no override is set", async () => {
    getSystemSettingValueMock.mockResolvedValueOnce(null);
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.getStudioAgentInstructionsTemplate();

    expect(getSystemSettingValueMock).toHaveBeenCalledWith(
      "studio_agent_instructions_template",
    );
    expect(result).toEqual({
      source: "default",
      template: null,
      effectiveTemplate: "default template",
    });
  });

  it("stores trimmed custom agent instructions template", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.setStudioAgentInstructionsTemplate({
      template: "  custom template  ",
    });

    expect(setSystemSettingValueMock).toHaveBeenCalledWith(
      "studio_agent_instructions_template",
      "custom template",
    );
    expect(result).toEqual({ success: true, source: "system_setting" });
  });

  it("refreshes desired image cache when clearing override tag", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.setStudioMachineImageOverrideTag({ tag: null });

    expect(result).toMatchObject({
      provider: "fly",
      updated: true,
    });
    expect(setSystemSettingValueMock).toHaveBeenCalledWith(
      "studio_machine_image_tag_override",
      null,
    );
    expect(invalidateDesiredImageCacheMock).toHaveBeenCalledTimes(1);
    expect(getDesiredImageMock).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("forces desired image refresh before reconcile", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.reconcileStudioMachines();

    expect(reconcileStudioMachinesMock).toHaveBeenCalledWith({
      forceRefreshDesiredImage: true,
    });
    expect(result).toMatchObject({
      provider: "fly",
      reconciled: true,
      result: {
        desiredImage: "ghcr.io/vivd-studio/vivd-studio:latest",
      },
    });
  });

  it("reconciles a specific managed studio machine", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.reconcileStudioMachine({ machineId: "machine-1" });

    expect(reconcileStudioMachineMock).toHaveBeenCalledWith("machine-1", {
      forceRefreshDesiredImage: true,
    });
    expect(result).toEqual({
      provider: "fly",
      reconciled: true,
      result: {
        desiredImage: "ghcr.io/vivd-studio/vivd-studio:latest",
      },
    });
  });

  it("parks managed studio machines and returns the parked state", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.parkStudioMachine({ machineId: "machine-1" });

    expect(parkStudioMachineMock).toHaveBeenCalledWith("machine-1");
    expect(result).toEqual({
      provider: "fly",
      parked: true,
      state: "suspended",
    });
  });

  it("destroys managed studio machines for docker provider", async () => {
    (studioMachineProviderMock as any).kind = "docker";
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.destroyStudioMachine({ machineId: "container-1" });

    expect(destroyStudioMachineMock).toHaveBeenCalledWith("container-1");
    expect(result).toEqual({
      provider: "docker",
      destroyed: true,
    });
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
