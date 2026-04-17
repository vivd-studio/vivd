import {
  newsletterPluginConfigSchema,
  type NewsletterPluginConfig,
} from "./config";
import { newsletterPluginDefinition } from "./module";
import type {
  NewsletterPluginInstanceRow,
  NewsletterPluginServiceDeps,
} from "./ports";
import { getNewsletterSnippets } from "./snippets";
import { createNewsletterCampaignOperations } from "./campaignOperations";
import {
  NewsletterPluginNotEnabledError,
  normalizeNewsletterConfig,
  resolvePublicEndpoints,
} from "./serviceShared";
import { createNewsletterSubscriberOperations } from "./subscriberOperations";
import {
  normalizeHostAllowlist,
  resolveDefaultSuccessRedirectTarget,
  resolveEffectiveSourceHosts,
} from "./sourceHosts";

export { resolveDefaultSuccessRedirectTarget };
export {
  NewsletterCampaignDeliveryError,
  NewsletterCampaignNotFoundError,
  NewsletterCampaignStateError,
  NewsletterConfirmationDeliveryError,
  NewsletterPluginNotEnabledError,
  NewsletterSignupRateLimitError,
  NewsletterSignupSourceHostError,
  NewsletterSubscriberNotFoundError,
  NewsletterSubscriberSuppressedError,
} from "./serviceShared";

export function createNewsletterPluginService(deps: NewsletterPluginServiceDeps) {
  const { pluginEntitlementService, projectPluginInstanceService, inferSourceHosts } =
    deps;
  const subscriberOperations = createNewsletterSubscriberOperations(deps);
  const campaignOperations = createNewsletterCampaignOperations(deps);

  async function buildInfoPayload(options: {
    organizationId: string;
    projectSlug: string;
    existing: NewsletterPluginInstanceRow | null;
  }) {
    const [entitlement, inferredSourceHosts, endpoints, counts] =
      await Promise.all([
        pluginEntitlementService.resolveEffectiveEntitlement({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: "newsletter",
        }),
        inferSourceHosts({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
        }),
        resolvePublicEndpoints(deps),
        subscriberOperations.getSubscriberCounts({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
        }),
      ]);

    const enabled =
      entitlement.state === "enabled" && options.existing?.status === "enabled";
    const config = options.existing
      ? normalizeNewsletterConfig(options.existing.configJson)
      : null;
    const snippets =
      options.existing && config
        ? getNewsletterSnippets(
            options.existing.publicToken,
            endpoints.subscribeEndpoint,
            config,
          )
        : null;
    const effectiveSourceHosts = config
      ? resolveEffectiveSourceHosts(config, inferredSourceHosts, deps)
      : normalizeHostAllowlist(inferredSourceHosts, deps);

    return {
      entitled: entitlement.state === "enabled",
      entitlementState: entitlement.state,
      enabled,
      instanceId: options.existing?.id ?? null,
      status: options.existing?.status ?? null,
      publicToken: options.existing?.publicToken ?? null,
      config,
      snippets,
      usage: {
        subscribeEndpoint: endpoints.subscribeEndpoint,
        confirmEndpoint: endpoints.confirmEndpoint,
        unsubscribeEndpoint: endpoints.unsubscribeEndpoint,
        expectedFields: config?.collectName
          ? ["token", "name", "email"]
          : ["token", "email"],
        optionalFields: ["_redirect", "_honeypot"],
        inferredAutoSourceHosts: effectiveSourceHosts,
      },
      details: {
        counts,
      },
      instructions: [
        "Newsletter signups always use double opt-in in this v1.",
        ...(newsletterPluginDefinition.agentHints ?? []),
        "Install the generated HTML or Astro snippet and keep the hidden token field unchanged.",
        "Export confirmed subscribers from the project page or with `vivd plugins read newsletter subscribers`.",
      ],
    };
  }

  class NewsletterPluginServiceImpl {
    async ensureNewsletterPlugin(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const { row, created } =
        await projectPluginInstanceService.ensurePluginInstance({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: "newsletter",
        });

      const config = normalizeNewsletterConfig(row.configJson);
      const endpoints = await resolvePublicEndpoints(deps);
      return {
        pluginId: "newsletter" as const,
        instanceId: row.id,
        status: row.status,
        created,
        publicToken: row.publicToken,
        config,
        snippets: getNewsletterSnippets(
          row.publicToken,
          endpoints.subscribeEndpoint,
          config,
        ),
      };
    }

    async getNewsletterInfo(options: {
      organizationId: string;
      projectSlug: string;
    }) {
      const existing = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });

      return buildInfoPayload({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        existing,
      });
    }

    async updateNewsletterConfig(options: {
      organizationId: string;
      projectSlug: string;
      config: NewsletterPluginConfig;
    }) {
      const entitlement =
        await pluginEntitlementService.resolveEffectiveEntitlement({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginId: "newsletter",
        });
      if (entitlement.state !== "enabled") {
        throw new NewsletterPluginNotEnabledError();
      }

      const parsedConfig = newsletterPluginConfigSchema.parse(options.config);
      const { row } = await projectPluginInstanceService.ensurePluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "newsletter",
      });

      const updated = await projectPluginInstanceService.updatePluginInstance({
        instanceId: row.id,
        configJson: parsedConfig,
        status: "enabled",
        updatedAt: new Date(),
      });

      return buildInfoPayload({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        existing:
          updated ??
          ({
            ...row,
            status: "enabled",
            configJson: parsedConfig,
          } satisfies NewsletterPluginInstanceRow),
      });
    }

    subscribe = subscriberOperations.subscribe;
    confirmByToken = subscriberOperations.confirmByToken;
    unsubscribeByToken = subscriberOperations.unsubscribeByToken;
    resendConfirmation = subscriberOperations.resendConfirmation;
    markConfirmed = subscriberOperations.markConfirmed;
    unsubscribeSubscriber = subscriberOperations.unsubscribeSubscriber;
    getNewsletterSummary = subscriberOperations.getNewsletterSummary;
    listSubscribers = subscriberOperations.listSubscribers;
    listCampaigns = campaignOperations.listCampaigns;
    saveCampaignDraft = campaignOperations.saveCampaignDraft;
    deleteCampaignDraft = campaignOperations.deleteCampaignDraft;
    testSendCampaign = campaignOperations.testSendCampaign;
    sendCampaign = campaignOperations.sendCampaign;
    cancelCampaign = campaignOperations.cancelCampaign;
    processQueuedCampaigns = campaignOperations.processQueuedCampaigns;
  }

  return new NewsletterPluginServiceImpl();
}

export type NewsletterPluginService = ReturnType<
  typeof createNewsletterPluginService
>;
