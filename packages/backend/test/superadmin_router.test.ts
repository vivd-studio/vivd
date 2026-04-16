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
  listProjectAccessMock,
  getProjectEntitlementRowMock,
  ensurePluginInstanceMock,
  getTurnstileAutomationIssueMock,
  prepareTurnstileWidgetMock,
  deleteTurnstileWidgetMock,
  getDefaultTemplateMock,
  resolvePolicyMock,
  isExperimentalSoloModeEnabledMock,
  isSelfHostAdminFeaturesEnabledMock,
  updateInstallProfileMock,
  updateInstanceCapabilityPolicyMock,
  updateInstancePluginDefaultsMock,
  updateInstanceLimitDefaultsMock,
  getResolvedNetworkSettingsMock,
  updateStoredNetworkSettingsMock,
  syncSelfHostedCaddyConfigMock,
  reloadCaddyConfigMock,
  syncGeneratedCaddyConfigsMock,
  getInstanceSoftwareStatusMock,
  startManagedInstanceSoftwareUpdateMock,
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
    listProjectAccessMock: vi.fn(),
    getProjectEntitlementRowMock: vi.fn(),
    ensurePluginInstanceMock: vi.fn(),
    getTurnstileAutomationIssueMock: vi.fn(),
    prepareTurnstileWidgetMock: vi.fn(),
    deleteTurnstileWidgetMock: vi.fn(),
    getDefaultTemplateMock: vi.fn(),
    resolvePolicyMock: vi.fn(),
    isExperimentalSoloModeEnabledMock: vi.fn(),
    isSelfHostAdminFeaturesEnabledMock: vi.fn(),
    updateInstallProfileMock: vi.fn(),
    updateInstanceCapabilityPolicyMock: vi.fn(),
    updateInstancePluginDefaultsMock: vi.fn(),
    updateInstanceLimitDefaultsMock: vi.fn(),
    getResolvedNetworkSettingsMock: vi.fn(),
    updateStoredNetworkSettingsMock: vi.fn(),
    syncSelfHostedCaddyConfigMock: vi.fn(),
    reloadCaddyConfigMock: vi.fn(),
    syncGeneratedCaddyConfigsMock: vi.fn(),
    getInstanceSoftwareStatusMock: vi.fn(),
    startManagedInstanceSoftwareUpdateMock: vi.fn(),
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

vi.mock("../src/services/system/FeatureFlagsService", () => ({
  isExperimentalSoloModeEnabled: isExperimentalSoloModeEnabledMock,
  isSelfHostAdminFeaturesEnabled: isSelfHostAdminFeaturesEnabledMock,
}));

vi.mock("../src/services/system/InstanceNetworkSettingsService", async () => {
  const { z } = await import("zod");
  return {
    instanceNetworkSettingsSchema: z
      .object({
        publicHost: z.string().trim().min(1).max(255).nullable().optional(),
        tlsMode: z.enum(["managed", "external", "off"]).nullable().optional(),
        acmeEmail: z.string().trim().email().nullable().optional(),
      })
      .strict(),
    instanceNetworkSettingsService: {
      getResolvedSettings: getResolvedNetworkSettingsMock,
    },
  };
});

vi.mock("../src/services/system/InstanceSelfHostAdminService", () => ({
  instanceSelfHostAdminService: {
    updateStoredSettings: updateStoredNetworkSettingsMock,
    syncSelfHostedCaddyConfig: syncSelfHostedCaddyConfigMock,
  },
}));

vi.mock("../src/services/system/CaddyAdminService", () => ({
  reloadCaddyConfig: reloadCaddyConfigMock,
}));

vi.mock("../src/services/publish/PublishService", () => ({
  publishService: {
    syncGeneratedCaddyConfigs: syncGeneratedCaddyConfigsMock,
  },
}));

vi.mock("../src/services/system/InstanceSoftwareService", () => ({
  instanceSoftwareService: {
    getStatus: getInstanceSoftwareStatusMock,
    startManagedUpdate: startManagedInstanceSoftwareUpdateMock,
  },
}));

vi.mock("../src/services/studioMachines/fly/ghcr", () => ({
  listStudioImagesFromGhcr: listStudioImagesFromGhcrMock,
  normalizeGhcrRepository: normalizeGhcrRepositoryMock,
}));

vi.mock("../src/services/plugins/PluginEntitlementService", () => ({
  pluginEntitlementService: {
    upsertEntitlement: upsertEntitlementMock,
    listProjectAccess: listProjectAccessMock,
    getProjectEntitlementRow: getProjectEntitlementRowMock,
  },
}));

vi.mock("../src/services/plugins/ProjectPluginService", () => ({
  projectPluginService: {
    ensurePluginInstance: ensurePluginInstanceMock,
  },
}));

vi.mock("../src/services/plugins/contactForm/turnstile", () => ({
  contactFormTurnstileService: {
    getAutomationConfigurationIssue: getTurnstileAutomationIssueMock,
    prepareProjectWidgetCredentials: prepareTurnstileWidgetMock,
    deleteWidget: deleteTurnstileWidgetMock,
  },
}));

vi.mock("../src/services/plugins/contactForm/backendHooks", () => ({
  contactFormPluginBackendHooks: {
    buildOrganizationProjectSummaries: vi.fn(),
    prepareProjectEntitlementFields: vi.fn(async (options) => {
      const automationIssue = getTurnstileAutomationIssueMock();
      if (automationIssue) {
        throw new Error(automationIssue);
      }

      if (options.state !== "enabled" || options.turnstileEnabled !== true) {
        return {
          turnstileEnabled: false,
          turnstileWidgetId: null,
          turnstileSiteKey: null,
          turnstileSecretKey: null,
        };
      }

      const prepared = await prepareTurnstileWidgetMock({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        existingWidgetId: options.existingProjectEntitlement?.turnstileWidgetId ?? null,
        existingSiteKey: options.existingProjectEntitlement?.turnstileSiteKey ?? null,
        existingSecretKey: options.existingProjectEntitlement?.turnstileSecretKey ?? null,
      });

      return {
        turnstileEnabled: true,
        turnstileWidgetId: prepared.widgetId,
        turnstileSiteKey: prepared.siteKey,
        turnstileSecretKey: prepared.secretKey,
      };
    }),
    cleanupProjectEntitlementFields: vi.fn(async (options) => {
      const widgetId = options.existingProjectEntitlement?.turnstileWidgetId;
      if (options.state !== "enabled" && widgetId) {
        await deleteTurnstileWidgetMock(widgetId);
      }
      if (
        options.state === "enabled" &&
        options.turnstileEnabled !== true &&
        widgetId
      ) {
        await deleteTurnstileWidgetMock(widgetId);
      }
    }),
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
    listProjectAccessMock.mockReset();
    getProjectEntitlementRowMock.mockReset();
    ensurePluginInstanceMock.mockReset();
    getTurnstileAutomationIssueMock.mockReset();
    prepareTurnstileWidgetMock.mockReset();
    deleteTurnstileWidgetMock.mockReset();
    getDefaultTemplateMock.mockReset();
    resolvePolicyMock.mockReset();
    isExperimentalSoloModeEnabledMock.mockReset();
    isSelfHostAdminFeaturesEnabledMock.mockReset();
    updateInstallProfileMock.mockReset();
    updateInstanceCapabilityPolicyMock.mockReset();
    updateInstancePluginDefaultsMock.mockReset();
    updateInstanceLimitDefaultsMock.mockReset();
    getResolvedNetworkSettingsMock.mockReset();
    updateStoredNetworkSettingsMock.mockReset();
    syncSelfHostedCaddyConfigMock.mockReset();
    reloadCaddyConfigMock.mockReset();
    syncGeneratedCaddyConfigsMock.mockReset();
    getInstanceSoftwareStatusMock.mockReset();
    startManagedInstanceSoftwareUpdateMock.mockReset();

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
    listProjectAccessMock.mockResolvedValue({
      rows: [],
      total: 0,
    });
    getProjectEntitlementRowMock.mockResolvedValue(null);
    ensurePluginInstanceMock.mockResolvedValue({
      instanceId: "ppi-1",
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
    getInstanceSoftwareStatusMock.mockResolvedValue({
      currentVersion: "1.1.33",
      currentRevision: "abc123def456",
      currentImage: "ghcr.io/vivd-studio/vivd-server:1.1.33",
      currentImageTag: "1.1.33",
      latestVersion: "1.1.34",
      latestTag: "1.1.34",
      latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.34",
      releaseStatus: "available",
      managedUpdate: {
        enabled: false,
        reason: "Platform deployments stay deployment-managed for now.",
        helperImage: null,
        workdir: null,
      },
    });
    startManagedInstanceSoftwareUpdateMock.mockResolvedValue({
      started: true,
      helperContainerId: "helper-1",
      helperImage: "docker:28-cli",
      targetTag: "1.1.34",
    });
    resolvePolicyMock.mockResolvedValue({
      installProfile: "platform",
      singleProjectMode: false,
      selfHostCompatibility: {
        enabled: false,
        adminFeaturesVisible: false,
      },
      adminSurface: {
        label: "Super Admin",
        instanceSectionLabel: "Instance",
        showPlatformSections: true,
        installProfileEditable: true,
        capabilitiesEditable: true,
      },
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
    isExperimentalSoloModeEnabledMock.mockReturnValue(false);
    isSelfHostAdminFeaturesEnabledMock.mockReturnValue(false);

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

  it("returns instance software status for the active install profile", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.getInstanceSoftware();

    expect(result).toMatchObject({
      currentVersion: "1.1.33",
      latestVersion: "1.1.34",
      releaseStatus: "available",
    });
    expect(getInstanceSoftwareStatusMock).toHaveBeenCalledWith("platform");
  });

  it("rejects network updates while the effective install profile is platform", async () => {
    isSelfHostAdminFeaturesEnabledMock.mockReturnValue(true);
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(
      caller.updateSelfHostNetworkSettings({
        publicHost: "example.com",
        tlsMode: "external",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Instance network settings are currently UI-managed only for experimental self-host compatibility installs.",
    });

    expect(updateStoredNetworkSettingsMock).not.toHaveBeenCalled();
    expect(syncGeneratedCaddyConfigsMock).not.toHaveBeenCalled();
  });

  it("rejects hidden self-host admin feature mutations before applying network changes", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(
      caller.updateSelfHostNetworkSettings({
        publicHost: "example.com",
        tlsMode: "external",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Experimental self-host admin features are hidden for this installation.",
    });

    expect(updateStoredNetworkSettingsMock).not.toHaveBeenCalled();
    expect(syncGeneratedCaddyConfigsMock).not.toHaveBeenCalled();
  });

  it("rejects install profile changes from a solo instance", async () => {
    resolvePolicyMock.mockResolvedValueOnce({
      installProfile: "solo",
      singleProjectMode: false,
      selfHostCompatibility: {
        enabled: true,
        adminFeaturesVisible: false,
      },
      adminSurface: {
        label: "Instance Settings",
        instanceSectionLabel: "General",
        showPlatformSections: false,
        installProfileEditable: false,
        capabilitiesEditable: false,
      },
      capabilities: {
        multiOrg: false,
        tenantHosts: false,
        customDomains: false,
        orgLimitOverrides: false,
        orgPluginEntitlements: false,
        projectPluginEntitlements: false,
        dedicatedPluginHost: false,
      },
      pluginDefaults: {
        contact_form: {
          pluginId: "contact_form",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
        analytics: {
          pluginId: "analytics",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
      },
      limitDefaults: {},
      controlPlane: { mode: "path_based" },
      pluginRuntime: { mode: "same_host_path" },
    });
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(
      caller.updateInstanceSettings({
        installProfile: "platform",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Install profile changes are not available from the UI on solo installs.",
    });

    expect(updateInstallProfileMock).not.toHaveBeenCalled();
  });

  it("rejects advanced capability updates from a solo instance", async () => {
    resolvePolicyMock.mockResolvedValueOnce({
      installProfile: "solo",
      singleProjectMode: false,
      selfHostCompatibility: {
        enabled: true,
        adminFeaturesVisible: false,
      },
      adminSurface: {
        label: "Instance Settings",
        instanceSectionLabel: "General",
        showPlatformSections: false,
        installProfileEditable: false,
        capabilitiesEditable: false,
      },
      capabilities: {
        multiOrg: false,
        tenantHosts: false,
        customDomains: false,
        orgLimitOverrides: false,
        orgPluginEntitlements: false,
        projectPluginEntitlements: false,
        dedicatedPluginHost: false,
      },
      pluginDefaults: {
        contact_form: {
          pluginId: "contact_form",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
        analytics: {
          pluginId: "analytics",
          state: "enabled",
          managedBy: "manual_superadmin",
        },
      },
      limitDefaults: {},
      controlPlane: { mode: "path_based" },
      pluginRuntime: { mode: "same_host_path" },
    });
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(
      caller.updateInstanceSettings({
        capabilities: {
          multiOrg: true,
        },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Advanced tenancy capabilities are not editable on solo installs.",
    });

    expect(updateInstanceCapabilityPolicyMock).not.toHaveBeenCalled();
  });

  it("allows explicit solo network updates through the experimental self-host mutation", async () => {
    isSelfHostAdminFeaturesEnabledMock.mockReturnValue(true);
    resolvePolicyMock.mockResolvedValue({
      installProfile: "solo",
      singleProjectMode: true,
      selfHostCompatibility: {
        enabled: true,
        adminFeaturesVisible: true,
      },
      adminSurface: {
        label: "Instance Settings",
        instanceSectionLabel: "General",
        showPlatformSections: false,
        installProfileEditable: false,
        capabilitiesEditable: false,
      },
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

    await caller.updateSelfHostNetworkSettings({
      publicHost: "example.com",
      tlsMode: "managed",
      acmeEmail: "admin@example.com",
    });

    expect(updateInstallProfileMock).not.toHaveBeenCalled();
    expect(updateStoredNetworkSettingsMock).toHaveBeenCalledWith({
      publicHost: "example.com",
      tlsMode: "managed",
      acmeEmail: "admin@example.com",
    });
    expect(syncGeneratedCaddyConfigsMock).toHaveBeenCalledTimes(1);
  });

  it("rejects switching to solo while experimental solo mode is disabled", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(
      caller.updateInstanceSettings({
        installProfile: "solo",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Solo mode is currently experimental-only and disabled for this installation.",
    });

    expect(updateInstallProfileMock).not.toHaveBeenCalled();
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

  it("rejects managed instance updates on platform installs", async () => {
    isSelfHostAdminFeaturesEnabledMock.mockReturnValue(true);
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(caller.startSelfHostManagedUpdate()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Managed updates are available only for experimental self-host compatibility installs.",
    });

    expect(startManagedInstanceSoftwareUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects managed instance updates while self-host admin features stay hidden", async () => {
    const caller = superAdminRouter.createCaller(makeContext());

    await expect(caller.startSelfHostManagedUpdate()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Experimental self-host admin features are hidden for this installation.",
    });

    expect(startManagedInstanceSoftwareUpdateMock).not.toHaveBeenCalled();
  });

  it("starts managed instance updates for solo installs when a newer release exists", async () => {
    isSelfHostAdminFeaturesEnabledMock.mockReturnValue(true);
    resolvePolicyMock.mockResolvedValue({
      installProfile: "solo",
      singleProjectMode: true,
      selfHostCompatibility: {
        enabled: true,
        adminFeaturesVisible: true,
      },
      adminSurface: {
        label: "Instance Settings",
        instanceSectionLabel: "General",
        showPlatformSections: false,
        installProfileEditable: false,
        capabilitiesEditable: false,
      },
      capabilities: {
        multiOrg: false,
        tenantHosts: false,
        customDomains: false,
        orgLimitOverrides: false,
        orgPluginEntitlements: false,
        projectPluginEntitlements: false,
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
    getInstanceSoftwareStatusMock.mockResolvedValue({
      currentVersion: "1.1.33",
      currentRevision: "abc123def456",
      currentImage: "ghcr.io/vivd-studio/vivd-server:1.1.33",
      currentImageTag: "1.1.33",
      latestVersion: "1.1.34",
      latestTag: "1.1.34",
      latestImage: "ghcr.io/vivd-studio/vivd-server:1.1.34",
      releaseStatus: "available",
      managedUpdate: {
        enabled: true,
        reason: null,
        helperImage: "docker:28-cli",
        workdir: "/srv/selfhost",
      },
    });
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.startSelfHostManagedUpdate();

    expect(result).toMatchObject({
      started: true,
      targetTag: "1.1.34",
    });
    expect(startManagedInstanceSoftwareUpdateMock).toHaveBeenCalledWith({
      installProfile: "solo",
      targetTag: "1.1.34",
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
        devLimit: 100,
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
    expect(ensurePluginInstanceMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "contact_form",
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

    expect(ensurePluginInstanceMock).not.toHaveBeenCalled();
    expect(result.ensuredPluginInstanceId).toBeNull();
  });

  it("ensures an analytics plugin instance when enabling analytics for a project", async () => {
    ensurePluginInstanceMock.mockResolvedValueOnce({
      instanceId: "ppi-analytics-1",
    });
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

    expect(ensurePluginInstanceMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectSlug: "site-1",
      pluginId: "analytics",
    });
    expect(result.ensuredPluginInstanceId).toBe("ppi-analytics-1");
  });

  it("groups project plugin access rows across all registered plugins", async () => {
    listProjectAccessMock
      .mockResolvedValueOnce({
        rows: [
          {
            organizationId: "org-1",
            organizationSlug: "org-1",
            organizationName: "Org One",
            projectSlug: "site-1",
            projectTitle: "Site 1",
            isDeployed: true,
            deployedDomain: "site-1.example.com",
            effectiveScope: "project",
            state: "enabled",
            managedBy: "manual_superadmin",
            monthlyEventLimit: 100,
            hardStop: true,
            turnstileEnabled: true,
            turnstileReady: true,
            usageThisMonth: 10,
            projectPluginStatus: "enabled",
            updatedAt: new Date("2026-02-22T10:00:00.000Z"),
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            organizationId: "org-1",
            organizationSlug: "org-1",
            organizationName: "Org One",
            projectSlug: "site-1",
            projectTitle: "Site 1",
            isDeployed: true,
            deployedDomain: "site-1.example.com",
            effectiveScope: "project",
            state: "disabled",
            managedBy: "manual_superadmin",
            monthlyEventLimit: null,
            hardStop: true,
            turnstileEnabled: false,
            turnstileReady: false,
            usageThisMonth: 0,
            projectPluginStatus: "disabled",
            updatedAt: new Date("2026-02-22T11:00:00.000Z"),
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        rows: [],
        total: 0,
      })
      .mockResolvedValueOnce({
        rows: [],
        total: 0,
      });
    const caller = superAdminRouter.createCaller(makeContext());

    const result = await caller.pluginsListAccess({
      limit: 500,
      offset: 0,
    });

    expect(listProjectAccessMock).toHaveBeenCalledTimes(result.pluginCatalog.length);
    expect(result.pluginCatalog.map((plugin) => plugin.pluginId)).toEqual(
      expect.arrayContaining([
        "contact_form",
        "analytics",
        "table_booking",
        "newsletter",
      ]),
    );
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      organizationId: "org-1",
      projectSlug: "site-1",
    });
    expect(result.rows[0]?.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: "contact_form",
          organizationId: "org-1",
          projectSlug: "site-1",
          state: "enabled",
        }),
        expect.objectContaining({
          pluginId: "analytics",
          organizationId: "org-1",
          projectSlug: "site-1",
          state: "disabled",
        }),
      ]),
    );
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
