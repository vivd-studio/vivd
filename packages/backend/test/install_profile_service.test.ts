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
  ["VIVD_SELFHOST_UPDATE_WORKDIR", process.env.VIVD_SELFHOST_UPDATE_WORKDIR],
  ["VIVD_CADDY_PRIMARY_HOST", process.env.VIVD_CADDY_PRIMARY_HOST],
  ["CADDY_ADMIN_URL", process.env.CADDY_ADMIN_URL],
  ["CADDY_SITES_DIR", process.env.CADDY_SITES_DIR],
  ["CADDY_RUNTIME_ROUTES_DIR", process.env.CADDY_RUNTIME_ROUTES_DIR],
  ["TENANT_DOMAIN_ROUTING_ENABLED", process.env.TENANT_DOMAIN_ROUTING_ENABLED],
  ["TENANT_BASE_DOMAIN", process.env.TENANT_BASE_DOMAIN],
  ["CONTROL_PLANE_HOST", process.env.CONTROL_PLANE_HOST],
  ["VIVD_BUCKET_MODE", process.env.VIVD_BUCKET_MODE],
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
    delete process.env.VIVD_SELFHOST_UPDATE_WORKDIR;
    delete process.env.VIVD_CADDY_PRIMARY_HOST;
    delete process.env.CADDY_ADMIN_URL;
    delete process.env.CADDY_SITES_DIR;
    delete process.env.CADDY_RUNTIME_ROUTES_DIR;
    delete process.env.TENANT_DOMAIN_ROUTING_ENABLED;
    delete process.env.TENANT_BASE_DOMAIN;
    delete process.env.CONTROL_PLANE_HOST;
    delete process.env.VIVD_BUCKET_MODE;
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
    expect(setSystemSettingValueMock).toHaveBeenCalledWith(
      "install_profile",
      "platform",
    );

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
    expect(setSystemSettingValueMock).toHaveBeenCalledWith(
      "install_profile",
      "platform",
    );

    await expect(installProfileService.isSingleProjectModeEnabled()).resolves.toBe(false);
  });

  it("coerces solo env bootstrap to platform while the experimental flag is off", async () => {
    process.env.VIVD_INSTALL_PROFILE = "solo";

    await expect(installProfileService.getInstallProfile()).resolves.toBe("platform");
    expect(setSystemSettingValueMock).not.toHaveBeenCalled();
  });

  it("allows solo env bootstrap when the experimental flag is enabled", async () => {
    process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE = "true";
    process.env.VIVD_INSTALL_PROFILE = "solo";

    await expect(installProfileService.getInstallProfile()).resolves.toBe("solo");
    expect(setSystemSettingValueMock).toHaveBeenCalledWith(
      "install_profile",
      "solo",
    );
  });

  it("prefers the stored profile over the env bootstrap value", async () => {
    process.env.VIVD_INSTALL_PROFILE = "platform";
    getSystemSettingValueMock.mockResolvedValueOnce("solo");

    await expect(installProfileService.getInstallProfile()).resolves.toBe("solo");
    expect(setSystemSettingValueMock).not.toHaveBeenCalled();
  });

  it("infers legacy bundled self-host installs as sticky solo", async () => {
    process.env.VIVD_SELFHOST_UPDATE_WORKDIR = "/srv/selfhost";
    process.env.CADDY_RUNTIME_ROUTES_DIR = "/etc/caddy/runtime.d";
    process.env.TENANT_DOMAIN_ROUTING_ENABLED = "false";

    await expect(installProfileService.getInstallProfile()).resolves.toBe("solo");
    expect(setSystemSettingValueMock).toHaveBeenCalledWith(
      "install_profile",
      "solo",
    );
  });

  it("does not infer solo when tenant-domain routing is explicitly enabled", async () => {
    process.env.VIVD_SELFHOST_UPDATE_WORKDIR = "/srv/selfhost";
    process.env.CADDY_RUNTIME_ROUTES_DIR = "/etc/caddy/runtime.d";
    process.env.TENANT_DOMAIN_ROUTING_ENABLED = "true";

    await expect(installProfileService.getInstallProfile()).resolves.toBe("platform");
    expect(setSystemSettingValueMock).toHaveBeenCalledWith(
      "install_profile",
      "platform",
    );
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
