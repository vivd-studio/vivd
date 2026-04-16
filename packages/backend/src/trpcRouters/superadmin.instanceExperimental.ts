import { TRPCError } from "@trpc/server";
import { superAdminProcedure } from "../trpc";
import {
  isSelfHostAdminFeaturesEnabled,
} from "../services/system/FeatureFlagsService";
import { installProfileService } from "../services/system/InstallProfileService";
import {
  instanceNetworkSettingsSchema,
} from "../services/system/InstanceNetworkSettingsService";
import { instanceSelfHostAdminService } from "../services/system/InstanceSelfHostAdminService";
import { instanceSoftwareService } from "../services/system/InstanceSoftwareService";
import { reloadCaddyConfig } from "../services/system/CaddyAdminService";
import { publishService } from "../services/publish/PublishService";

const SELF_HOST_ADMIN_FEATURES_MESSAGE =
  "Experimental self-host admin features are hidden for this installation.";

export const experimentalInstanceSuperAdminProcedures = {
  updateSelfHostNetworkSettings: superAdminProcedure
    .input(instanceNetworkSettingsSchema)
    .mutation(async ({ input }) => {
      if (!isSelfHostAdminFeaturesEnabled()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: SELF_HOST_ADMIN_FEATURES_MESSAGE,
        });
      }

      const policy = await installProfileService.resolvePolicy();
      if (policy.installProfile !== "solo") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Instance network settings are currently UI-managed only for solo installs.",
        });
      }

      await instanceSelfHostAdminService.updateStoredSettings(input);
      const caddyfileChanged =
        await instanceSelfHostAdminService.syncSelfHostedCaddyConfig();
      if (caddyfileChanged) {
        await reloadCaddyConfig();
      }
      await publishService.syncGeneratedCaddyConfigs();

      return { success: true as const };
    }),

  startSelfHostManagedUpdate: superAdminProcedure.mutation(async () => {
    if (!isSelfHostAdminFeaturesEnabled()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: SELF_HOST_ADMIN_FEATURES_MESSAGE,
      });
    }

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
