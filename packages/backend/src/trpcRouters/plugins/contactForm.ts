import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { contactFormPluginConfigSchema } from "../../services/plugins/contactForm/config";
import {
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
} from "../../services/plugins/contactForm/service";

const projectSlugInput = z.object({
  slug: z.string().min(1),
});

const contactConfigInput = z.object({
  slug: z.string().min(1),
  config: contactFormPluginConfigSchema,
});

export const contactEnsurePluginProcedure = projectMemberProcedure
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
      pluginId: "contact_form",
    });

    if (entitlement.state !== "enabled") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Contact Form is not entitled for this project",
      });
    }

    return projectPluginService.ensureContactFormPlugin({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
    });
  });

export const contactInfoPluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
  .query(async ({ ctx, input }) => {
    return projectPluginService.getContactFormInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
    });
  });

export const contactUpdateConfigPluginProcedure = projectMemberProcedure
  .input(contactConfigInput)
  .mutation(async ({ ctx, input }) => {
    try {
      return await projectPluginService.updateContactFormConfig({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        config: input.config,
      });
    } catch (error) {
      if (
        error instanceof ContactFormRecipientVerificationError ||
        error instanceof ContactFormRecipientRequiredError
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error.message,
        });
      }
      throw error;
    }
  });
