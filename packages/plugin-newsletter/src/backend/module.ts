import type {
  PluginActionContext,
  PluginDefinition,
  PluginInfoSourcePayload,
  PluginModule,
  PluginOperationContext,
  PluginPublicErrorContext,
  PluginReadContext,
  PluginUpdateConfigContext,
  ProjectPluginActionPayload,
  ProjectPluginReadPayload,
} from "@vivd/shared/types";
import {
  PluginActionArgumentError,
  UnsupportedPluginActionError,
  UnsupportedPluginReadError,
} from "@vivd/shared/types";
import {
  newsletterPluginConfigSchema,
  type NewsletterPluginConfig,
} from "./config";
import {
  NEWSLETTER_SUBSCRIBERS_READ_ID,
  NEWSLETTER_SUMMARY_READ_ID,
  newsletterSubscribersReadDefinition,
  newsletterSubscribersReadInputSchema,
  newsletterSummaryReadDefinition,
  newsletterSummaryReadInputSchema,
  type NewsletterSubscribersPayload,
  type NewsletterSummaryPayload,
} from "../shared/summary";
import type {
  NewsletterConfirmByTokenResult,
  NewsletterSubscriberMutationResult,
} from "./ports";

export const newsletterPluginDefinition = {
  pluginId: "newsletter",
  name: "Newsletter / Waitlist",
  description:
    "Capture confirmed newsletter subscribers or waitlist signups for your project.",
  category: "marketing",
  version: 1,
  sortOrder: 30,
  configSchema: newsletterPluginConfigSchema,
  defaultConfig: newsletterPluginConfigSchema.parse({}),
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
        actionId: "resend_confirmation",
        title: "Resend confirmation",
        description: "Resend the pending confirmation email for a subscriber.",
        arguments: [
          {
            name: "email",
            type: "email",
            required: true,
            description: "Subscriber email address to resend.",
          },
        ],
      },
      {
        actionId: "mark_confirmed",
        title: "Mark confirmed",
        description: "Manually mark a subscriber as confirmed.",
        arguments: [
          {
            name: "email",
            type: "email",
            required: true,
            description: "Subscriber email address to confirm.",
          },
        ],
      },
      {
        actionId: "unsubscribe",
        title: "Unsubscribe",
        description: "Mark a subscriber as unsubscribed.",
        arguments: [
          {
            name: "email",
            type: "email",
            required: true,
            description: "Subscriber email address to unsubscribe.",
          },
        ],
      },
    ],
    reads: [
      newsletterSummaryReadDefinition,
      newsletterSubscribersReadDefinition,
    ],
  },
  listUi: {
    projectPanel: "custom",
    usageLabel: "Signups",
    limitPrompt: "Set monthly signup limit.\nLeave empty for unlimited.",
    supportsMonthlyLimit: true,
    supportsHardStop: true,
    supportsTurnstile: false,
    dashboardPath: null,
  },
} satisfies PluginDefinition<"newsletter">;

export interface NewsletterPluginInfoSource {
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: NewsletterPluginConfig | null;
  snippets: {
    html: string;
    astro: string;
  } | null;
  usage: {
    subscribeEndpoint: string;
    confirmEndpoint: string;
    unsubscribeEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
    inferredAutoSourceHosts: string[];
  };
  details: {
    counts: {
      total: number;
      pending: number;
      confirmed: number;
      unsubscribed: number;
      bounced: number;
      complained: number;
    };
  };
  instructions: string[];
}

export interface NewsletterPluginBackendRuntime {
  ensurePlugin(options: PluginOperationContext): Promise<{
    instanceId: string;
    created: boolean;
    status: string;
  }>;
  getInfo(options: PluginOperationContext): Promise<NewsletterPluginInfoSource>;
  updateConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: NewsletterPluginConfig;
  }): Promise<NewsletterPluginInfoSource>;
  resendConfirmation(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
  }): Promise<NewsletterSubscriberMutationResult>;
  markConfirmed(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
  }): Promise<NewsletterSubscriberMutationResult>;
  unsubscribeSubscriber(options: {
    organizationId: string;
    projectSlug: string;
    email: string;
  }): Promise<NewsletterSubscriberMutationResult>;
  readSummary(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: 7 | 30;
  }): Promise<NewsletterSummaryPayload>;
  readSubscribers(options: {
    organizationId: string;
    projectSlug: string;
    status: "all" | "pending" | "confirmed" | "unsubscribed" | "bounced" | "complained";
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<NewsletterSubscribersPayload>;
  mapPublicError?(
    context: PluginPublicErrorContext,
  ): { code: "BAD_REQUEST" | "UNAUTHORIZED" | "INTERNAL_SERVER_ERROR"; message: string } | null;
}

function toNewsletterInfoPayload(
  info: NewsletterPluginInfoSource,
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
    details: info.details,
    instructions: info.instructions,
  };
}

async function runNewsletterAction(
  runtime: NewsletterPluginBackendRuntime,
  options: PluginActionContext,
): Promise<ProjectPluginActionPayload<"newsletter">> {
  if (
    options.actionId !== "resend_confirmation" &&
    options.actionId !== "mark_confirmed" &&
    options.actionId !== "unsubscribe"
  ) {
    throw new UnsupportedPluginActionError("newsletter", options.actionId);
  }

  const email = options.args[0]?.trim();
  if (!email) {
    throw new PluginActionArgumentError(
      `Plugin action "${options.actionId}" requires an email argument.`,
    );
  }

  const result =
    options.actionId === "resend_confirmation"
      ? await runtime.resendConfirmation({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          email,
        })
      : options.actionId === "mark_confirmed"
        ? await runtime.markConfirmed({
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            email,
          })
        : await runtime.unsubscribeSubscriber({
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            email,
          });

  return {
    pluginId: "newsletter",
    actionId: options.actionId,
    summary:
      options.actionId === "resend_confirmation"
        ? "Resent confirmation email."
        : options.actionId === "mark_confirmed"
          ? "Marked subscriber as confirmed."
          : "Marked subscriber as unsubscribed.",
    result,
  };
}

async function runNewsletterRead(
  runtime: NewsletterPluginBackendRuntime,
  options: PluginReadContext,
): Promise<ProjectPluginReadPayload<"newsletter">> {
  if (options.readId === NEWSLETTER_SUMMARY_READ_ID) {
    const input = newsletterSummaryReadInputSchema.parse(options.input);
    return {
      pluginId: "newsletter",
      readId: options.readId,
      result: await runtime.readSummary({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        rangeDays: input.rangeDays,
      }),
    };
  }

  if (options.readId === NEWSLETTER_SUBSCRIBERS_READ_ID) {
    const input = newsletterSubscribersReadInputSchema.parse(options.input);
    return {
      pluginId: "newsletter",
      readId: options.readId,
      result: await runtime.readSubscribers({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        status: input.status,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      }),
    };
  }

  throw new UnsupportedPluginReadError("newsletter", options.readId);
}

export function createNewsletterPluginModule(
  runtime: NewsletterPluginBackendRuntime,
): PluginModule<"newsletter"> {
  return {
    definition: newsletterPluginDefinition,
    ensureInstance(options) {
      return runtime.ensurePlugin(options);
    },
    async getInfoPayload(options) {
      return toNewsletterInfoPayload(await runtime.getInfo(options));
    },
    async updateConfig(options: PluginUpdateConfigContext) {
      return toNewsletterInfoPayload(
        await runtime.updateConfig({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          config: newsletterPluginConfigSchema.parse(options.config),
        }),
      );
    },
    runAction(options) {
      return runNewsletterAction(runtime, options);
    },
    runRead(options) {
      return runNewsletterRead(runtime, options);
    },
    mapPublicError(context: PluginPublicErrorContext) {
      return runtime.mapPublicError?.(context) ?? null;
    },
  };
}

export type {
  NewsletterPluginConfig,
  NewsletterSummaryPayload,
  NewsletterSubscribersPayload,
  NewsletterConfirmByTokenResult,
};
