import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { superAdminProcedure } from "../trpc";
import {
  PLUGIN_IDS,
  listPluginCatalogEntries,
} from "../services/plugins/registry";
import {
  installProfileSchema,
  installProfileService,
  instancePluginDefaultsSchema,
  partialInstanceCapabilityPolicySchema,
} from "../services/system/InstallProfileService";
import {
  instanceNetworkSettingsService,
  instanceTlsModeSchema,
} from "../services/system/InstanceNetworkSettingsService";
import { instanceSoftwareService } from "../services/system/InstanceSoftwareService";
import { reloadCaddyConfig } from "../services/system/CaddyAdminService";
import { publishService } from "../services/publish/PublishService";

const instanceLimitDefaultsPatchSchema = z
  .object({
    dailyCreditLimit: z.number().nonnegative().nullable().optional(),
    weeklyCreditLimit: z.number().nonnegative().nullable().optional(),
    monthlyCreditLimit: z.number().nonnegative().nullable().optional(),
    imageGenPerMonth: z.number().int().nonnegative().nullable().optional(),
    warningThreshold: z.number().min(0.1).max(1).nullable().optional(),
    maxProjects: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

const instanceNetworkSettingsPatchSchema = z
  .object({
    publicHost: z.string().trim().min(1).max(255).nullable().optional(),
    tlsMode: instanceTlsModeSchema.nullable().optional(),
    acmeEmail: z.string().trim().email().nullable().optional(),
  })
  .strict();

const SOLO_INSTALL_PROFILE_LOCK_MESSAGE =
  "Install profile changes are not available from the UI on solo installs.";
const SOLO_CAPABILITIES_LOCK_MESSAGE =
  "Advanced tenancy capabilities are not editable on solo installs.";

async function buildInstanceSettingsPayload() {
  const policy = await installProfileService.resolvePolicy();
  const network = instanceNetworkSettingsService.getResolvedSettings();

  return {
    installProfile: policy.installProfile,
    singleProjectMode: policy.singleProjectMode,
    instanceAdminLabel:
      policy.installProfile === "solo" ? "Instance Settings" : "Super Admin",
    capabilities: policy.capabilities,
    pluginDefaults: Object.fromEntries(
      PLUGIN_IDS.map((pluginId) => [
        pluginId,
        {
          enabled: policy.pluginDefaults[pluginId].state === "enabled",
        },
      ]),
    ),
    pluginCatalog: listPluginCatalogEntries(),
    limitDefaults: policy.limitDefaults,
    controlPlane: policy.controlPlane,
    pluginRuntime: policy.pluginRuntime,
    network: {
      publicHost: network.publicHost,
      publicOrigin: network.publicOrigin,
      tlsMode: network.tlsMode,
      acmeEmail: network.acmeEmail,
      sources: network.sources,
      deploymentManaged: network.deploymentManaged,
    },
  };
}

export const instanceSuperAdminProcedures = {
  getInstanceSettings: superAdminProcedure.query(async () => {
    return await buildInstanceSettingsPayload();
  }),

  getInstanceSoftware: superAdminProcedure.query(async () => {
    const policy = await installProfileService.resolvePolicy();
    return await instanceSoftwareService.getStatus(policy.installProfile);
  }),

  updateInstanceSettings: superAdminProcedure
    .input(
      z
        .object({
          installProfile: installProfileSchema.optional(),
          capabilities: partialInstanceCapabilityPolicySchema.optional(),
          pluginDefaults: instancePluginDefaultsSchema.optional(),
          limitDefaults: instanceLimitDefaultsPatchSchema.optional(),
          network: instanceNetworkSettingsPatchSchema.optional(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const currentPolicy = await installProfileService.resolvePolicy();

      if (currentPolicy.installProfile === "solo" && input.installProfile) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: SOLO_INSTALL_PROFILE_LOCK_MESSAGE,
        });
      }

      if (currentPolicy.installProfile === "solo" && input.capabilities) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: SOLO_CAPABILITIES_LOCK_MESSAGE,
        });
      }

      const targetInstallProfile = input.installProfile ?? currentPolicy.installProfile;

      if (input.installProfile) {
        await installProfileService.updateInstallProfile(input.installProfile);
      }
      if (input.capabilities) {
        await installProfileService.updateInstanceCapabilityPolicy(input.capabilities);
      }
      if (input.pluginDefaults) {
        await installProfileService.updateInstancePluginDefaults(input.pluginDefaults);
      }
      if (input.limitDefaults) {
        await installProfileService.updateInstanceLimitDefaults(input.limitDefaults);
      }
      if (input.network) {
        if (targetInstallProfile !== "solo") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Instance network settings are currently UI-managed only for solo installs.",
          });
        }
        await instanceNetworkSettingsService.updateStoredSettings(input.network);
        const caddyfileChanged =
          await instanceNetworkSettingsService.syncSelfHostedCaddyConfig();
        if (caddyfileChanged) {
          await reloadCaddyConfig();
        }
        await publishService.syncGeneratedCaddyConfigs();
      }

      return {
        success: true,
        ...(await buildInstanceSettingsPayload()),
      };
    }),

  startInstanceSoftwareUpdate: superAdminProcedure.mutation(async () => {
    const policy = await installProfileService.resolvePolicy();
    if (policy.installProfile !== "solo") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Managed updates are available only for solo self-host installs.",
      });
    }

    const software = await instanceSoftwareService.getStatus(policy.installProfile);
    if (!software.managedUpdate.enabled) {
      return {
        started: false as const,
        error:
          software.managedUpdate.reason ||
          "Managed self-host updates are not configured for this installation.",
        targetTag: null,
      };
    }

    if (!software.latestTag) {
      return {
        started: false as const,
        error: "Could not resolve the latest release tag for this installation.",
        targetTag: null,
      };
    }

    if (software.releaseStatus === "current") {
      return {
        started: false as const,
        error: "This installation is already on the latest known release.",
        targetTag: software.latestTag,
      };
    }

    return await instanceSoftwareService.startManagedUpdate({
      installProfile: policy.installProfile,
      targetTag: software.latestTag,
    });
  }),
};
