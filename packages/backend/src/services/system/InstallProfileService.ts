import { z } from "zod";
import type { LimitsConfig } from "@vivd/shared/types";
import type {
  PluginEntitlementManagedBy,
  PluginEntitlementState,
} from "../plugins/PluginEntitlementService";
import {
  PLUGIN_IDS,
  getPluginDefaultEnabledByProfile,
  type PluginId,
} from "../plugins/catalog";
import {
  getSystemSettingJsonValue,
  getSystemSettingValue,
  setSystemSettingJsonValue,
  setSystemSettingValue,
  SYSTEM_SETTING_KEYS,
} from "./SystemSettingsService";

export const installProfileSchema = z.enum(["solo", "platform"]);
export type InstallProfile = z.infer<typeof installProfileSchema>;

export const instanceCapabilityPolicySchema = z.object({
  multiOrg: z.boolean(),
  tenantHosts: z.boolean(),
  customDomains: z.boolean(),
  orgLimitOverrides: z.boolean(),
  orgPluginEntitlements: z.boolean(),
  projectPluginEntitlements: z.boolean(),
  dedicatedPluginHost: z.boolean(),
});

export type InstanceCapabilityPolicy = z.infer<
  typeof instanceCapabilityPolicySchema
>;

export const partialInstanceCapabilityPolicySchema =
  instanceCapabilityPolicySchema.partial();

const instancePluginDefaultSchema = z.object({
  enabled: z.boolean().optional(),
});

export type InstancePluginDefault = z.infer<typeof instancePluginDefaultSchema>;
export type InstancePluginDefaults = Partial<Record<PluginId, InstancePluginDefault>>;

function buildInstancePluginDefaultsShape(): Record<
  PluginId,
  z.ZodOptional<typeof instancePluginDefaultSchema>
> {
  return Object.fromEntries(
    PLUGIN_IDS.map((pluginId) => [pluginId, instancePluginDefaultSchema.optional()]),
  ) as Record<PluginId, z.ZodOptional<typeof instancePluginDefaultSchema>>;
}

export const instancePluginDefaultsSchema = z
  .object(buildInstancePluginDefaultsShape())
  .strict();

export interface InstanceLimitDefaults extends Partial<LimitsConfig> {
  maxProjects?: number;
}

export const instanceLimitDefaultsSchema = z
  .object({
    dailyCreditLimit: z.number().nonnegative().optional(),
    weeklyCreditLimit: z.number().nonnegative().optional(),
    monthlyCreditLimit: z.number().nonnegative().optional(),
    imageGenPerMonth: z.number().int().nonnegative().optional(),
    warningThreshold: z.number().min(0.1).max(1).optional(),
    maxProjects: z.number().int().nonnegative().optional(),
  })
  .strict();

export interface ResolvedInstancePluginEntitlement {
  pluginId: PluginId;
  state: PluginEntitlementState;
  managedBy: PluginEntitlementManagedBy;
}

export interface ResolvedInstallProfilePolicy {
  installProfile: InstallProfile;
  singleProjectMode: boolean;
  capabilities: InstanceCapabilityPolicy;
  pluginDefaults: Record<PluginId, ResolvedInstancePluginEntitlement>;
  limitDefaults: InstanceLimitDefaults;
  controlPlane: {
    mode: "path_based" | "host_based";
  };
  pluginRuntime: {
    mode: "same_host_path" | "dedicated_host";
  };
}

const PROFILE_DEFAULT_CAPABILITIES: Record<InstallProfile, InstanceCapabilityPolicy> = {
  solo: {
    multiOrg: false,
    tenantHosts: false,
    customDomains: true,
    orgLimitOverrides: false,
    orgPluginEntitlements: false,
    projectPluginEntitlements: false,
    dedicatedPluginHost: false,
  },
  platform: {
    multiOrg: true,
    tenantHosts: true,
    customDomains: true,
    orgLimitOverrides: true,
    orgPluginEntitlements: true,
    projectPluginEntitlements: true,
    dedicatedPluginHost: true,
  },
};

const SOLO_FORCED_DISABLED_CAPABILITIES: Partial<InstanceCapabilityPolicy> = {
  multiOrg: false,
  tenantHosts: false,
  orgLimitOverrides: false,
  orgPluginEntitlements: false,
  dedicatedPluginHost: false,
};

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function isExperimentalSoloModeEnabled(): boolean {
  return parseBoolean(process.env.VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE) === true;
}

function normalizeInstallProfileSelection(
  profile: InstallProfile | null,
): InstallProfile | null {
  if (profile !== "solo") return profile;
  return isExperimentalSoloModeEnabled() ? "solo" : "platform";
}

function readEnvInstallProfile(): InstallProfile | null {
  const raw = process.env.VIVD_INSTALL_PROFILE?.trim();
  if (!raw) return null;
  const parsed = installProfileSchema.safeParse(raw);
  if (!parsed.success) return null;
  return normalizeInstallProfileSelection(parsed.data);
}

function parseEnvJson<T>(raw: string | undefined, schema: z.ZodType<T>): T | null {
  if (!raw?.trim()) return null;

  try {
    const parsed = JSON.parse(raw);
    const validated = schema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

function normalizeCapabilityPolicy(
  profile: InstallProfile,
  value: unknown,
): InstanceCapabilityPolicy {
  const parsed = partialInstanceCapabilityPolicySchema.safeParse(value);
  const merged = {
    ...PROFILE_DEFAULT_CAPABILITIES[profile],
    ...(parsed.success ? parsed.data : {}),
  };

  if (profile === "solo") {
    // Keep the platform-only subset disabled on solo even if older
    // platform-style capability overrides remain stored.
    return {
      ...merged,
      ...SOLO_FORCED_DISABLED_CAPABILITIES,
    };
  }

  return merged;
}

function normalizePluginDefaults(
  profile: InstallProfile,
  value: unknown,
): Record<PluginId, ResolvedInstancePluginEntitlement> {
  const parsed = instancePluginDefaultsSchema.safeParse(value);
  const configured = parsed.success ? parsed.data : {};

  return Object.fromEntries(
    PLUGIN_IDS.map((pluginId) => {
      const defaultEnabled = getPluginDefaultEnabledByProfile(pluginId, profile);
      const entry = configured[pluginId];
      const enabled =
        typeof entry?.enabled === "boolean" ? entry.enabled : defaultEnabled;

      return [
        pluginId,
        {
          pluginId,
          state: enabled ? ("enabled" as const) : ("disabled" as const),
          managedBy: "manual_superadmin" as const,
        },
      ];
    }),
  ) as Record<PluginId, ResolvedInstancePluginEntitlement>;
}

function normalizeLimitDefaults(value: unknown): InstanceLimitDefaults {
  const parsed = instanceLimitDefaultsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

async function readStoredInstallProfile(): Promise<InstallProfile | null> {
  const raw = await getSystemSettingValue(SYSTEM_SETTING_KEYS.installProfile);
  if (!raw) return null;
  const parsed = installProfileSchema.safeParse(raw.trim());
  return parsed.success ? normalizeInstallProfileSelection(parsed.data) : null;
}

class InstallProfileService {
  async getInstallProfile(): Promise<InstallProfile> {
    return (
      (await readStoredInstallProfile()) ??
      readEnvInstallProfile() ??
      "platform"
    );
  }

  async resolvePolicy(): Promise<ResolvedInstallProfilePolicy> {
    const installProfile = await this.getInstallProfile();

    const envCapabilities = parseEnvJson(
      process.env.VIVD_INSTANCE_CAPABILITY_POLICY,
      partialInstanceCapabilityPolicySchema,
    );
    const storedCapabilities = await getSystemSettingJsonValue<unknown>(
      SYSTEM_SETTING_KEYS.instanceCapabilityPolicy,
    );
    const capabilities = normalizeCapabilityPolicy(
      installProfile,
      storedCapabilities ?? envCapabilities,
    );

    const envPluginDefaults = parseEnvJson(
      process.env.VIVD_INSTANCE_PLUGIN_DEFAULTS,
      instancePluginDefaultsSchema,
    );
    const storedPluginDefaults = await getSystemSettingJsonValue<unknown>(
      SYSTEM_SETTING_KEYS.instancePluginDefaults,
    );
    const pluginDefaults = normalizePluginDefaults(
      installProfile,
      storedPluginDefaults ?? envPluginDefaults,
    );

    const envLimitDefaults = parseEnvJson(
      process.env.VIVD_INSTANCE_LIMIT_DEFAULTS,
      instanceLimitDefaultsSchema,
    );
    const storedLimitDefaults = await getSystemSettingJsonValue<unknown>(
      SYSTEM_SETTING_KEYS.instanceLimitDefaults,
    );
    const limitDefaults = normalizeLimitDefaults(
      storedLimitDefaults ?? envLimitDefaults,
    );

    return {
      installProfile,
      singleProjectMode: await this.isSingleProjectModeEnabled(installProfile),
      capabilities,
      pluginDefaults,
      limitDefaults,
      controlPlane: {
        mode: installProfile === "solo" ? "path_based" : "host_based",
      },
      pluginRuntime: {
        mode: capabilities.dedicatedPluginHost ? "dedicated_host" : "same_host_path",
      },
    };
  }

  async isSingleProjectModeEnabled(
    resolvedProfile?: InstallProfile,
  ): Promise<boolean> {
    const envValue = parseBoolean(process.env.SINGLE_PROJECT_MODE);
    if (envValue !== null) return envValue;
    void resolvedProfile;
    return false;
  }

  async updateInstallProfile(profile: InstallProfile): Promise<void> {
    if (profile === "solo" && !isExperimentalSoloModeEnabled()) {
      throw new Error(
        "Solo mode is currently experimental-only. Set VIVD_ENABLE_EXPERIMENTAL_SOLO_MODE=true to enable it.",
      );
    }
    await setSystemSettingValue(SYSTEM_SETTING_KEYS.installProfile, profile);
  }

  async updateInstanceCapabilityPolicy(
    patch: Partial<InstanceCapabilityPolicy>,
  ): Promise<InstanceCapabilityPolicy> {
    const installProfile = await this.getInstallProfile();
    const current = await getSystemSettingJsonValue<unknown>(
      SYSTEM_SETTING_KEYS.instanceCapabilityPolicy,
    );
    const normalizedCurrent = normalizeCapabilityPolicy(installProfile, current);
    const next = normalizeCapabilityPolicy(installProfile, {
      ...normalizedCurrent,
      ...patch,
    });
    await setSystemSettingJsonValue(
      SYSTEM_SETTING_KEYS.instanceCapabilityPolicy,
      next,
    );
    return next;
  }

  async updateInstancePluginDefaults(
    patch: InstancePluginDefaults,
  ): Promise<Record<PluginId, ResolvedInstancePluginEntitlement>> {
    const installProfile = await this.getInstallProfile();
    const current = await getSystemSettingJsonValue<unknown>(
      SYSTEM_SETTING_KEYS.instancePluginDefaults,
    );
    const currentStored = instancePluginDefaultsSchema.safeParse(current).success
      ? (current as InstancePluginDefaults)
      : {};
    const nextStored = {
      ...currentStored,
      ...patch,
    };
    await setSystemSettingJsonValue(
      SYSTEM_SETTING_KEYS.instancePluginDefaults,
      nextStored,
    );
    return normalizePluginDefaults(installProfile, nextStored);
  }

  async updateInstanceLimitDefaults(
    patch: Partial<Record<keyof InstanceLimitDefaults, number | null>>,
  ): Promise<InstanceLimitDefaults> {
    const current = await getSystemSettingJsonValue<unknown>(
      SYSTEM_SETTING_KEYS.instanceLimitDefaults,
    );
    const next = {
      ...normalizeLimitDefaults(current),
    } as Record<string, number>;

    for (const [key, value] of Object.entries(patch)) {
      if (value == null) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }

    const normalizedNext = normalizeLimitDefaults(next);
    await setSystemSettingJsonValue(
      SYSTEM_SETTING_KEYS.instanceLimitDefaults,
      normalizedNext,
    );
    return normalizedNext;
  }
}

export const installProfileService = new InstallProfileService();
