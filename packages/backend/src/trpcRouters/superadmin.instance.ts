import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { superAdminProcedure } from "../trpc";
import {
  PLUGIN_IDS,
  listPluginControlPlaneCatalogEntries,
} from "../services/plugins/registry";
import {
  installProfileSchema,
  installProfileService,
  instancePluginDefaultsSchema,
  partialInstanceCapabilityPolicySchema,
} from "../services/system/InstallProfileService";
import {
  isExperimentalSoloModeEnabled,
} from "../services/system/FeatureFlagsService";
import { instanceNetworkSettingsService } from "../services/system/InstanceNetworkSettingsService";
import { instanceSoftwareService } from "../services/system/InstanceSoftwareService";

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

const SOLO_INSTALL_PROFILE_LOCK_MESSAGE =
  "Install profile changes are not available from the UI on solo installs.";
const SOLO_CAPABILITIES_LOCK_MESSAGE =
  "Advanced tenancy capabilities are not editable on solo installs.";
const SOLO_EXPERIMENTAL_MODE_MESSAGE =
  "Solo mode is currently experimental-only and disabled for this installation.";

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
          enabled: policy.pluginDefaults[pluginId]?.state === "enabled",
        },
      ]),
    ),
    pluginCatalog: listPluginControlPlaneCatalogEntries(),
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
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const currentPolicy = await installProfileService.resolvePolicy();

      if (input.installProfile === "solo" && !isExperimentalSoloModeEnabled()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: SOLO_EXPERIMENTAL_MODE_MESSAGE,
        });
      }

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

      return {
        success: true,
        ...(await buildInstanceSettingsPayload()),
      };
    }),
};
