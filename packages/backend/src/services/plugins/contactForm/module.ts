import type { PluginDefinition } from "../registry";
import {
  PluginActionArgumentError,
  UnsupportedPluginActionError,
  type PluginActionContext,
  type PluginPublicErrorContext,
  type PluginInfoSourcePayload,
  type PluginModule,
  type PluginOperationContext,
  type PluginUpdateConfigContext,
} from "../core/module";
import {
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./config";
import {
  ContactFormPluginNotEnabledError,
  ContactFormRecipientRequiredError,
  ContactFormRecipientVerificationError,
  contactFormPluginService,
} from "./service";
import {
  ContactRecipientEmailFormatError,
  ContactRecipientVerificationPendingLimitError,
  ContactRecipientVerificationSendError,
} from "./recipientVerification";
import { ContactRecipientVerificationEndpointUnavailableError } from "./publicApi";

export const contactFormPluginDefinition = {
  pluginId: "contact_form",
  name: "Contact Form",
  description: "Collect visitor inquiries and store submissions in Vivd.",
  category: "forms",
  version: 1,
  sortOrder: 10,
  configSchema: contactFormPluginConfigSchema,
  defaultConfig: contactFormPluginConfigSchema.parse({}),
  defaultEnabledByProfile: {
    solo: true,
    platform: false,
  },
  capabilities: {
    supportsInfo: true,
    config: {
      format: "json",
      supportsShow: true,
      supportsApply: true,
      supportsTemplate: true,
    },
    actions: [
      {
        actionId: "verify_recipient",
        title: "Verify recipient",
        description:
          "Send or retry verification for a contact-form recipient email.",
        arguments: [
          {
            name: "email",
            type: "email",
            required: true,
            description: "Recipient email address to verify.",
          },
        ],
      },
      {
        actionId: "resend_recipient",
        title: "Resend recipient verification",
        description:
          "Resend verification for a contact-form recipient email address.",
        arguments: [
          {
            name: "email",
            type: "email",
            required: true,
            description: "Recipient email address to resend verification for.",
          },
        ],
      },
    ],
  },
  listUi: {
    projectPanel: "custom",
    usageLabel: "Submissions",
    limitPrompt:
      "Set monthly contact form submission limit.\nLeave empty for unlimited.",
    supportsMonthlyLimit: true,
    supportsHardStop: true,
    supportsTurnstile: true,
    dashboardPath: null,
  },
} satisfies PluginDefinition;

async function getContactFormInfoPayload(
  options: PluginOperationContext,
): Promise<PluginInfoSourcePayload> {
  const info = await contactFormPluginService.getContactFormInfo(options);
  return {
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config,
    snippets: info.snippets,
    usage: info.usage,
    details: {
      recipients: info.recipients,
    },
    instructions: info.instructions,
  };
}

async function updateContactFormConfigPayload(
  options: PluginUpdateConfigContext,
): Promise<PluginInfoSourcePayload> {
  await contactFormPluginService.updateContactFormConfig({
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    config: contactFormPluginConfigSchema.parse(options.config),
  });
  return getContactFormInfoPayload(options);
}

async function runContactFormAction(options: PluginActionContext) {
  if (
    options.actionId !== "verify_recipient" &&
    options.actionId !== "resend_recipient"
  ) {
    throw new UnsupportedPluginActionError("contact_form", options.actionId);
  }

  const email = options.args[0]?.trim();
  if (!email) {
    throw new PluginActionArgumentError(
      `Plugin action "${options.actionId}" requires an email argument.`,
    );
  }

  const result = await contactFormPluginService.requestRecipientVerification({
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    email,
    requestedByUserId: options.requestedByUserId,
    requestHost: options.requestHost,
  });

  return {
    pluginId: "contact_form" as const,
    actionId: options.actionId,
    summary:
      options.actionId === "resend_recipient"
        ? "Resent recipient verification request."
        : "Requested recipient verification.",
    result,
  };
}

function mapContactFormPublicError(
  context: PluginPublicErrorContext,
) {
  const { error } = context;
  if (
    error instanceof ContactFormRecipientVerificationError ||
    error instanceof ContactFormRecipientRequiredError ||
    error instanceof ContactFormPluginNotEnabledError ||
    error instanceof ContactRecipientEmailFormatError ||
    error instanceof ContactRecipientVerificationPendingLimitError
  ) {
    return {
      code: "BAD_REQUEST" as const,
      message: error.message,
    };
  }
  if (error instanceof ContactRecipientVerificationSendError) {
    return {
      code: "INTERNAL_SERVER_ERROR" as const,
      message: error.message,
    };
  }
  if (error instanceof ContactRecipientVerificationEndpointUnavailableError) {
    return {
      code: "INTERNAL_SERVER_ERROR" as const,
      message:
        "Could not generate verification link for this host. Please contact support.",
    };
  }
  return null;
}

export const contactFormPluginModule: PluginModule = {
  definition: contactFormPluginDefinition,
  async ensureInstance(options) {
    const result = await contactFormPluginService.ensureContactFormPlugin(options);
    return {
      instanceId: result.instanceId,
      created: result.created,
      status: result.status,
    };
  },
  getInfoPayload: getContactFormInfoPayload,
  updateConfig: updateContactFormConfigPayload,
  runAction: runContactFormAction,
  mapPublicError: mapContactFormPublicError,
};

export { contactFormPluginConfigSchema };
export type { ContactFormPluginConfig };
