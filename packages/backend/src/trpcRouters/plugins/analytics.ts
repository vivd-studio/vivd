import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { analyticsPluginConfigSchema } from "../../services/plugins/analytics/config";

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

export const analyticsInfoPluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
  .query(async ({ ctx, input }) => {
    return projectPluginService.getAnalyticsInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
    });
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

    return projectPluginService.ensureAnalyticsPlugin({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
    });
  });

export const analyticsUpdateConfigPluginProcedure = projectMemberProcedure
  .input(analyticsConfigInput)
  .mutation(async ({ ctx, input }) => {
    try {
      return await projectPluginService.updateAnalyticsConfig({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        config: input.config,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Analytics plugin is not enabled for this project")
      ) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: error.message,
        });
      }
      throw error;
    }
  });

export const analyticsSummaryPluginProcedure = projectMemberProcedure
  .input(analyticsSummaryInput)
  .query(async ({ ctx, input }) => {
    return projectPluginService.getAnalyticsSummary({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      rangeDays: input.rangeDays,
    });
  });
