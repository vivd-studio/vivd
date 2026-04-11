import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { PLUGIN_IDS } from "../../services/plugins/catalog";
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
});

export const readPluginInput = z.object({
  slug: z.string().min(1),
  pluginId: z.enum(PLUGIN_IDS),
  readId: z.string().trim().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
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
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: `${input.pluginId} is not entitled for this project`,
      });
    }

    return projectPluginService.ensurePluginInstance({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: input.pluginId,
    });
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
      requestedByUserId: ctx.session.user.id,
      requestHost:
        ctx.requestHost ??
        extractRequestHost(ctx.req.headers["x-forwarded-host"]) ??
        extractRequestHost(ctx.req.headers.host),
    });
  });
