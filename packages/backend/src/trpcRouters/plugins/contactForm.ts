import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { projectPluginService } from "../../services/plugins/ProjectPluginService";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { contactFormPluginConfigSchema } from "../../services/plugins/contactForm/config";
import {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
} from "../../services/plugins/contactForm/service";
import {
  ContactRecipientEmailFormatError,
  ContactRecipientVerificationPendingLimitError,
  ContactRecipientVerificationSendError,
} from "../../services/plugins/contactForm/recipientVerification";
import { ContactRecipientVerificationEndpointUnavailableError } from "../../services/plugins/contactForm/publicApi";

const projectSlugInput = z.object({
  slug: z.string().min(1),
});

const contactConfigInput = z.object({
  slug: z.string().min(1),
  config: contactFormPluginConfigSchema,
});

const contactRecipientInput = z.object({
  slug: z.string().min(1),
  email: z.string().trim().min(1),
});

function extractRequestHost(
  rawHost: string | string[] | undefined,
): string | null {
  if (typeof rawHost === "string") {
    const normalized = rawHost.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }
  if (Array.isArray(rawHost) && rawHost.length > 0) {
    const normalized = rawHost[0]?.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }
  return null;
}

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

export const contactRequestRecipientVerificationPluginProcedure = projectMemberProcedure
  .input(contactRecipientInput)
  .mutation(async ({ ctx, input }) => {
    try {
      return await projectPluginService.requestContactRecipientVerification({
        organizationId: ctx.organizationId!,
        projectSlug: input.slug,
        email: input.email,
        requestedByUserId: ctx.session.user.id,
        requestHost:
          ctx.requestHost ??
          extractRequestHost(ctx.req.headers["x-forwarded-host"]) ??
          extractRequestHost(ctx.req.headers.host),
      });
    } catch (error) {
      if (
        error instanceof ContactFormPluginNotEnabledError ||
        error instanceof ContactRecipientEmailFormatError ||
        error instanceof ContactRecipientVerificationPendingLimitError
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error.message,
        });
      }
      if (error instanceof ContactRecipientVerificationSendError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      if (error instanceof ContactRecipientVerificationEndpointUnavailableError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Could not generate verification link for this host. Please contact support.",
        });
      }
      throw error;
    }
  });
