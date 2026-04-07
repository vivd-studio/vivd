import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import type {
  ContactFormPluginInfoPayload,
  ContactFormPluginPayload,
} from "../../services/plugins/ProjectPluginService";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import { contactFormPluginConfigSchema } from "../../services/plugins/contactForm/config";
import type { ContactRecipientVerificationRequestResult } from "../../services/plugins/contactForm/recipientVerification";
import {
  ensureProjectPluginInstance,
  extractRequestHost,
  getProjectPluginInfo,
  runProjectPluginAction,
  updateProjectPluginConfig,
} from "./operations";

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

function buildLegacyContactPluginPayload(
  info: Awaited<ReturnType<typeof getProjectPluginInfo>>,
  created: boolean,
): ContactFormPluginPayload {
  if (
    info.pluginId !== "contact_form" ||
    !info.instanceId ||
    !info.publicToken ||
    !info.config ||
    !info.snippets
  ) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Contact Form plugin payload is incomplete after ensure/config update.",
    });
  }

  return {
    pluginId: "contact_form",
    instanceId: info.instanceId,
    status: info.status ?? "enabled",
    created,
    publicToken: info.publicToken,
    config: info.config as ContactFormPluginPayload["config"],
    snippets: info.snippets as ContactFormPluginPayload["snippets"],
  };
}

function buildLegacyContactPluginInfo(
  info: Awaited<ReturnType<typeof getProjectPluginInfo>>,
): ContactFormPluginInfoPayload {
  const details =
    info.details && typeof info.details === "object" ? info.details : null;
  const recipients =
    details && "recipients" in details && details.recipients
      ? details.recipients
      : { options: [], pending: [] };

  return {
    pluginId: "contact_form",
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config as ContactFormPluginInfoPayload["config"],
    snippets: info.snippets as ContactFormPluginInfoPayload["snippets"],
    usage: info.usage as ContactFormPluginInfoPayload["usage"],
    recipients: recipients as ContactFormPluginInfoPayload["recipients"],
    instructions: info.instructions,
  };
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

    const ensured = await ensureProjectPluginInstance({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "contact_form",
    });
    const info = await getProjectPluginInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "contact_form",
    });
    return buildLegacyContactPluginPayload(info, ensured.created);
  });

export const contactInfoPluginProcedure = projectMemberProcedure
  .input(projectSlugInput)
  .query(async ({ ctx, input }) => {
    const info = await getProjectPluginInfo({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "contact_form",
    });
    return buildLegacyContactPluginInfo(info);
  });

export const contactUpdateConfigPluginProcedure = projectMemberProcedure
  .input(contactConfigInput)
  .mutation(async ({ ctx, input }) => {
    const info = await updateProjectPluginConfig({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "contact_form",
      config: input.config,
    });
    return buildLegacyContactPluginPayload(info, false);
  });

export const contactRequestRecipientVerificationPluginProcedure = projectMemberProcedure
  .input(contactRecipientInput)
  .mutation(async ({ ctx, input }) => {
    const result = await runProjectPluginAction({
      organizationId: ctx.organizationId!,
      projectSlug: input.slug,
      pluginId: "contact_form",
      actionId: "verify_recipient",
      args: [input.email],
      requestedByUserId: ctx.session.user.id,
      requestHost:
        ctx.requestHost ??
        extractRequestHost(ctx.req.headers["x-forwarded-host"]) ??
        extractRequestHost(ctx.req.headers.host),
    });

    return result.result as ContactRecipientVerificationRequestResult;
  });
