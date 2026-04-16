import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSystemSettingValueMock,
  getSystemSettingJsonValueMock,
  setSystemSettingValueMock,
  setSystemSettingJsonValueMock,
} = vi.hoisted(() => ({
  getSystemSettingValueMock: vi.fn(),
  getSystemSettingJsonValueMock: vi.fn(),
  setSystemSettingValueMock: vi.fn(),
  setSystemSettingJsonValueMock: vi.fn(),
}));

vi.mock("../src/services/system/SystemSettingsService", () => ({
  SYSTEM_SETTING_KEYS: {
    installProfile: "install_profile",
    instanceCapabilityPolicy: "instance_capability_policy",
    instancePluginDefaults: "instance_plugin_defaults",
    instanceLimitDefaults: "instance_limit_defaults",
  },
  getSystemSettingValue: getSystemSettingValueMock,
  getSystemSettingJsonValue: getSystemSettingJsonValueMock,
  setSystemSettingValue: setSystemSettingValueMock,
  setSystemSettingJsonValue: setSystemSettingJsonValueMock,
}));

import { installProfileService } from "../src/services/system/InstallProfileService";

const ORIGINAL_ENV = new Map<string, string | undefined>([
  ["VIVD_INSTALL_PROFILE", process.env.VIVD_INSTALL_PROFILE],
  ["VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE", process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE],
  ["SINGLE_PROJECT_MODE", process.env.SINGLE_PROJECT_MODE],
  ["VIVD_INSTANCE_CAPABILITY_POLICY", process.env.VIVD_INSTANCE_CAPABILITY_POLICY],
  ["VIVD_INSTANCE_PLUGIN_DEFAULTS", process.env.VIVD_INSTANCE_PLUGIN_DEFAULTS],
  ["VIVD_INSTANCE_LIMIT_DEFAULTS", process.env.VIVD_INSTANCE_LIMIT_DEFAULTS],
]);

function restoreEnv(): void {
  for (const [key, value] of ORIGINAL_ENV) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

describe("InstallProfileService", () => {
  beforeEach(() => {
    restoreEnv();
    getSystemSettingValueMock.mockReset();
    getSystemSettingJsonValueMock.mockReset();
    setSystemSettingValueMock.mockReset();
    setSystemSettingJsonValueMock.mockReset();
    getSystemSettingValueMock.mockResolvedValue(null);
    getSystemSettingJsonValueMock.mockResolvedValue(null);
    delete process.env.VIVD_INSTALL_PROFILE;
    delete process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE;
    delete process.env.SINGLE_PROJECT_MODE;
    delete process.env.VIVD_INSTANCE_CAPABILITY_POLICY;
    delete process.env.VIVD_INSTANCE_PLUGIN_DEFAULTS;
    delete process.env.VIVD_INSTANCE_LIMIT_DEFAULTS;
  });

  afterEach(() => {
    restoreEnv();
  });

  it("defaults fresh installs to platform when no stored or env profile is set", async () => {
    await expect(installProfileService.getInstallProfile()).resolves.toBe("platform");

    await expect(installProfileService.isSingleProjectModeEnabled()).resolves.toBe(false);
    await expect(installProfileService.resolvePolicy()).resolves.toMatchObject({
      installProfile: "platform",
      capabilities: {
        customDomains: true,
        tenantHosts: true,
      },
    });
  });

  it("uses explicit platform env when configured", async () => {
    process.env.VIVD_INSTALL_PROFILE = "platform";

    await expect(installProfileService.getInstallProfile()).resolves.toBe("platform");

    await expect(installProfileService.isSingleProjectModeEnabled()).resolves.toBe(false);
  });

  it("coerces solo env bootstrap to platform while the experimental flag is off", async () => {
    process.env.VIVD_INSTALL_PROFILE = "solo";

    await expect(installProfileService.getInstallProfile()).resolves.toBe("platform");
  });

  it("allows solo env bootstrap when the experimental flag is enabled", async () => {
    process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE = "true";
    process.env.VIVD_INSTALL_PROFILE = "solo";

    await expect(installProfileService.getInstallProfile()).resolves.toBe("solo");
  });

  it("prefers the stored profile over the env bootstrap value", async () => {
    process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE = "true";
    process.env.VIVD_INSTALL_PROFILE = "platform";
    getSystemSettingValueMock.mockResolvedValueOnce("solo");

    await expect(installProfileService.getInstallProfile()).resolves.toBe("solo");
  });

  it("keeps the platform-only capability subset disabled on solo", async () => {
    process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE = "true";
    getSystemSettingValueMock.mockResolvedValueOnce("solo");
    getSystemSettingJsonValueMock.mockImplementation(async (key: string) => {
      if (key === "instance_capability_policy") {
        return {
          multiOrg: true,
          tenantHosts: true,
          customDomains: true,
          orgLimitOverrides: true,
          orgPluginEntitlements: true,
          projectPluginEntitlements: true,
          dedicatedPluginHost: true,
        };
      }

      return null;
    });

    await expect(installProfileService.resolvePolicy()).resolves.toMatchObject({
      installProfile: "solo",
      selfHostCompatibility: {
        enabled: true,
        adminFeaturesVisible: false,
      },
      adminSurface: {
        label: "Instance Settings",
        instanceSectionLabel: "General",
        showPlatformSections: false,
      },
      capabilities: {
        multiOrg: false,
        tenantHosts: false,
        customDomains: true,
        orgLimitOverrides: false,
        orgPluginEntitlements: false,
        projectPluginEntitlements: true,
        dedicatedPluginHost: false,
      },
      controlPlane: {
        mode: "path_based",
      },
      pluginRuntime: {
        mode: "same_host_path",
      },
    });
  });

  it("rejects enabling solo when the experimental flag is off", async () => {
    await expect(installProfileService.updateInstallProfile("solo")).rejects.toThrow(
      /experimental-only/i,
    );
    expect(setSystemSettingValueMock).not.toHaveBeenCalled();
  });
});
