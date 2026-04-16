import type {
  PluginActionContext,
  PluginDefinition,
  PluginInfoSourcePayload,
  PluginModule,
  PluginOperationContext,
  PluginPublicErrorContext,
  PluginPublicErrorPayload,
  PluginUpdateConfigContext,
  ProjectPluginActionPayload,
} from "@vivd/plugin-sdk";
import {
  PluginActionArgumentError,
  UnsupportedPluginActionError,
} from "@vivd/plugin-sdk";
import {
  DEFAULT_CONTACT_FORM_FIELDS,
  contactFormFieldSchema,
  contactFormFieldTypeSchema,
  contactFormPluginConfigSchema,
  type ContactFormPluginConfig,
} from "./config";

export const contactFormPluginDefinition = {
  pluginId: "contact_form",
  name: "Contact Form",
  description: "Collect visitor inquiries and store submissions in Vivd.",
  category: "forms",
  version: 1,
  sortOrder: 10,
  configSchema: contactFormPluginConfigSchema,
  defaultConfig: contactFormPluginConfigSchema.parse({}),
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
        actionId: "mark_recipient_verified",
        title: "Mark recipient verified",
        description:
          "Manually mark a contact-form recipient email as verified and add it to the project config.",
        arguments: [
          {
            name: "email",
            type: "email",
            required: true,
            description: "Recipient email address to mark as verified.",
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
} satisfies PluginDefinition<"contact_form">;

export interface ContactRecipientOption {
  email: string;
  isVerified: boolean;
  isPending: boolean;
}

export interface ContactPendingRecipient {
  email: string;
  lastSentAt: string | null;
}

export interface ContactRecipientDirectory {
  options: ContactRecipientOption[];
  pending: ContactPendingRecipient[];
}

export interface ContactRecipientVerificationRequestResult {
  email: string;
  status:
    | "already_verified"
    | "added_verified"
    | "marked_verified"
    | "verification_sent"
    | "verification_pending";
  cooldownRemainingSeconds: number;
}

export interface ContactFormPluginInfoSource {
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: ContactFormPluginConfig | null;
  snippets: {
    html: string;
    astro: string;
  } | null;
  usage: {
    submitEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
    inferredAutoSourceHosts: string[];
    turnstileEnabled: boolean;
    turnstileConfigured: boolean;
  };
  recipients: ContactRecipientDirectory;
  instructions: string[];
}

export interface ContactFormPluginBackendRuntime {
  ensurePlugin(options: PluginOperationContext): Promise<{
    instanceId: string;
    created: boolean;
    status: string;
  }>;
  getInfo(options: PluginOperationContext): Promise<ContactFormPluginInfoSource>;
  updateConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: ContactFormPluginConfig;
  }): Promise<ContactFormPluginInfoSource>;
  requestRecipientVerification(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
    requestedByUserId?: string | null;
    requestHost?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult>;
  markRecipientVerified(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
    requestedByUserId?: string | null;
  }): Promise<ContactRecipientVerificationRequestResult>;
  mapPublicError?(
    context: PluginPublicErrorContext,
  ): PluginPublicErrorPayload | null;
}

function toContactFormInfoPayload(
  info: ContactFormPluginInfoSource,
): PluginInfoSourcePayload {
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

async function runContactFormAction(
  runtime: ContactFormPluginBackendRuntime,
  options: PluginActionContext,
): Promise<ProjectPluginActionPayload<"contact_form">> {
  if (
    options.actionId !== "mark_recipient_verified" &&
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

  const result =
    options.actionId === "mark_recipient_verified"
      ? await runtime.markRecipientVerified({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          email,
          requestedByUserId: options.requestedByUserId,
        })
      : await runtime.requestRecipientVerification({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          email,
          requestedByUserId: options.requestedByUserId,
          requestHost: options.requestHost,
        });

  return {
    pluginId: "contact_form",
    actionId: options.actionId,
    summary:
      options.actionId === "mark_recipient_verified"
        ? "Marked recipient email as verified."
        : options.actionId === "resend_recipient"
        ? "Resent recipient verification request."
        : "Requested recipient verification.",
    result,
  };
}

export function createContactFormPluginModule(
  runtime: ContactFormPluginBackendRuntime,
): PluginModule<"contact_form"> {
  return {
    definition: contactFormPluginDefinition,
    ensureInstance(options) {
      return runtime.ensurePlugin(options);
    },
    async getInfoPayload(options) {
      return toContactFormInfoPayload(await runtime.getInfo(options));
    },
    async updateConfig(options: PluginUpdateConfigContext) {
      return toContactFormInfoPayload(
        await runtime.updateConfig({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          config: contactFormPluginConfigSchema.parse(options.config),
        }),
      );
    },
    runAction(options) {
      return runContactFormAction(runtime, options);
    },
    mapPublicError(context) {
      return runtime.mapPublicError?.(context) ?? null;
    },
  };
}

export {
  DEFAULT_CONTACT_FORM_FIELDS,
  contactFormFieldSchema,
  contactFormFieldTypeSchema,
  contactFormPluginConfigSchema,
};
export type { ContactFormPluginConfig };
