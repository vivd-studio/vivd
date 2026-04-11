import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import type {
  AnalyticsPluginInfoPayload,
  AnalyticsPluginPayload,
  AnalyticsSummaryPayload,
} from "../../services/plugins/ProjectPluginService";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { analyticsPluginConfigSchema } from "@vivd/plugin-analytics/backend/config";
import {
  ensureProjectPluginInstance,
  getProjectPluginInfo,
  readProjectPluginData,
  updateProjectPluginConfig,
} from "./operations";

const projectSlugInput = z.object({
  slug: z.string().min(1),
});

const analyticsConfigInput = z.object({
  slug: z.string().min(1),
  config: analyticsPluginConfigSchema,
});

const analyticsSummaryInput = z.object({
  slug: z.string().min(1),
  rangeDays: z.union([z.literal(7), z.literal(30)]).default(30),
});

function buildLegacyAnalyticsPluginPayload(
  info: Awaited<ReturnType<typeof getProjectPluginInfo>>,
  created: boolean,
): AnalyticsPluginPayload {
  if (
    info.pluginId !== "analytics" ||
    !info.instanceId ||
    !info.publicToken ||
    !info.config ||
    !info.snippets
  ) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Analytics plugin payload is incomplete after ensure/config update.",
    });
  }

  return {
    pluginId: "analytics",
    instanceId: info.instanceId,
    status: info.status ?? "enabled",
    created,
    publicToken: info.publicToken,
    config: info.config as AnalyticsPluginPayload["config"],
    snippets: info.snippets as AnalyticsPluginPayload["snippets"],
  };
}

function buildLegacyAnalyticsPluginInfo(
  info: Awaited<ReturnType<typeof getProjectPluginInfo>>,
): AnalyticsPluginInfoPayload {
  return {
    pluginId: "analytics",
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config as AnalyticsPluginInfoPayload["config"],
    snippets: info.snippets as AnalyticsPluginInfoPayload["snippets"],
    usage: info.usage as AnalyticsPluginInfoPayload["usage"],
    instructions: info.instructions,
  };
}

export const analyticsInfoPluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
  .query(async ({ ctx, input }) => {
    const info = await getProjectPluginInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "analytics",
    });
    return buildLegacyAnalyticsPluginInfo(info);
  });

export const analyticsEnsurePluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
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
      pluginId: "analytics",
    });

    if (entitlement.state !== "enabled") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Analytics is not entitled for this project",
      });
    }

    const ensured = await ensureProjectPluginInstance({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "analytics",
    });
    const info = await getProjectPluginInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "analytics",
    });
    return buildLegacyAnalyticsPluginPayload(info, ensured.created);
  });

export const analyticsUpdateConfigPluginProcedure = projectMemberProcedure
  .input(analyticsConfigInput)
  .mutation(async ({ ctx, input }) => {
    const info = await updateProjectPluginConfig({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "analytics",
      config: input.config,
    });
    return buildLegacyAnalyticsPluginPayload(info, false);
  });

export const analyticsSummaryPluginProcedure = projectMemberProcedure
  .input(analyticsSummaryInput)
  .query(async ({ ctx, input }) => {
    const result = await readProjectPluginData({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "analytics",
      readId: "summary",
      input: {
        rangeDays: input.rangeDays,
      },
    });
    return result.result as AnalyticsSummaryPayload;
  });
