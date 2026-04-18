import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  cleanupPluginProjectEntitlementFields,
  preparePluginProjectEntitlementFields,
} from "../../services/plugins/integrationHooks";
import { projectMemberProcedure } from "../../trpc";
import { pluginAccessRequestService } from "../../services/plugins/PluginAccessRequestService";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { PLUGIN_IDS } from "../../services/plugins/catalog";
import { projectPluginInstanceService } from "../../services/plugins/core/instanceService";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import {
  extractRequestHost,
  getProjectPluginInfo,
  readProjectPluginData,
  runProjectPluginAction,
  updateProjectPluginConfig,
} from "./operations";

export const ensurePluginInput = z.object({
  slug: z.string().min(1),
  pluginId: z.enum(PLUGIN_IDS),
});

export const infoPluginInput = z.object({
  slug: z.string().min(1),
  pluginId: z.enum(PLUGIN_IDS),
});

export const updatePluginConfigInput = z.object({
  slug: z.string().min(1),
  pluginId: z.enum(PLUGIN_IDS),
  config: z.record(z.string(), z.unknown()),
});

export const runPluginActionInput = z.object({
  slug: z.string().min(1),
  pluginId: z.enum(PLUGIN_IDS),
  actionId: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const readPluginInput = z.object({
  slug: z.string().min(1),
  pluginId: z.enum(PLUGIN_IDS),
  readId: z.string().trim().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const requestPluginAccessInput = z.object({
  slug: z.string().min(1),
  pluginId: z.enum(PLUGIN_IDS),
});

export const ensurePluginProcedure = projectMemberProcedure
  .input(ensurePluginInput)
  .mutation(async ({ ctx, input }) => {
    if (ctx.session.user.role !== "super_admin") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Only super-admin users can enable plugins",
      });
    }

    const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
    });

    if (entitlement.state !== "enabled") {
      const existingProjectEntitlement =
        await pluginEntitlementService.getProjectEntitlementRow({
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          pluginId: input.pluginId,
        });
      const existingProjectEntitlementSnapshot = existingProjectEntitlement
        ? {
            turnstileWidgetId: existingProjectEntitlement.turnstileWidgetId ?? null,
            turnstileSiteKey: existingProjectEntitlement.turnstileSiteKey ?? null,
            turnstileSecretKey: existingProjectEntitlement.turnstileSecretKey ?? null,
          }
        : null;
      const preparedEntitlementFields =
        await preparePluginProjectEntitlementFields({
          pluginId: input.pluginId,
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          state: "enabled",
          turnstileEnabled: existingProjectEntitlement?.turnstileEnabled ?? false,
          existingProjectEntitlement: existingProjectEntitlementSnapshot,
        });

      await pluginEntitlementService.upsertEntitlement({
        organizationId: ctx.organizationId!,
        scope: "project",
        projectSlug: input.slug,
        pluginId: input.pluginId,
        state: "enabled",
        managedBy: "manual_superadmin",
        monthlyEventLimit: existingProjectEntitlement?.monthlyEventLimit ?? null,
        hardStop: existingProjectEntitlement?.hardStop ?? true,
        turnstileEnabled: preparedEntitlementFields.turnstileEnabled,
        turnstileWidgetId: preparedEntitlementFields.turnstileWidgetId,
        turnstileSiteKey: preparedEntitlementFields.turnstileSiteKey,
        turnstileSecretKey: preparedEntitlementFields.turnstileSecretKey,
        notes:
          (existingProjectEntitlement?.notes || "").trim() ||
          "Enabled from project plugin controls",
        changedByUserId: ctx.session.user.id,
      });

      await cleanupPluginProjectEntitlementFields({
        pluginId: input.pluginId,
        state: "enabled",
        turnstileEnabled: preparedEntitlementFields.turnstileEnabled,
        existingProjectEntitlement: existingProjectEntitlementSnapshot,
      });
    }

    return projectPluginService.ensurePluginInstance({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
    });
  });

export const requestPluginAccessProcedure = projectMemberProcedure
  .input(requestPluginAccessInput)
  .mutation(async ({ ctx, input }) => {
    if (ctx.session.user.role === "super_admin") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Super-admin users can enable plugins directly",
      });
    }

    const instance = await projectPluginInstanceService.getPluginInstance({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
    });
    if (instance?.status === "enabled") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Plugin is already enabled for this project",
      });
    }

    try {
      return {
        pluginId: input.pluginId,
        accessRequest: await pluginAccessRequestService.requestAccess({
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          pluginId: input.pluginId,
          requestedByUserId: ctx.session.user.id,
          requesterEmail: ctx.session.user.email,
          requesterName: ctx.session.user.name,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message,
      });
    }
  });

export const infoPluginProcedure = projectMemberProcedure
  .input(infoPluginInput)
  .query(async ({ ctx, input }) => {
    return getProjectPluginInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
    });
  });

export const updatePluginConfigProcedure = projectMemberProcedure
  .input(updatePluginConfigInput)
  .mutation(async ({ ctx, input }) => {
    return updateProjectPluginConfig({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
      config: input.config,
    });
  });

export const readPluginProcedure = projectMemberProcedure
  .input(readPluginInput)
  .query(async ({ ctx, input }) => {
    return readProjectPluginData({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
      readId: input.readId,
      input: input.input,
    });
  });

export const runPluginActionProcedure = projectMemberProcedure
  .input(runPluginActionInput)
  .mutation(async ({ ctx, input }) => {
    return runProjectPluginAction({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
      actionId: input.actionId,
      args: input.args,
      input: input.input,
      requestedByUserId: ctx.session.user.id,
      requestHost:
        ctx.requestHost ??
        extractRequestHost(ctx.req.headers["x-forwarded-host"]) ??
        extractRequestHost(ctx.req.headers.host),
    });
  });
