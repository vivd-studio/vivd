import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import { PLUGIN_IDS } from "../../services/plugins/registry";

const ensurePluginInput = z.object({
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
