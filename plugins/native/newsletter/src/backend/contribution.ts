import type { PluginContribution } from "@vivd/plugin-sdk";
import type {
  NewsletterBackendRouteDefinition,
  NewsletterPluginServiceDeps,
} from "./ports";
import { createNewsletterPluginBackendHooks } from "./integrationHooks";
import { createNewsletterPluginModule } from "./module";
import {
  NewsletterCampaignNotFoundError,
  NewsletterCampaignStateError,
  NewsletterCampaignDeliveryError,
  NewsletterConfirmationDeliveryError,
  NewsletterPluginNotEnabledError,
  NewsletterSignupRateLimitError,
  NewsletterSignupSourceHostError,
  NewsletterSubscriberNotFoundError,
  NewsletterSubscriberSuppressedError,
  createNewsletterPluginService,
  type NewsletterPluginService,
} from "./service";
import { createNewsletterConfirmRouter } from "./http/confirm";
import { createNewsletterSubscribeRouter } from "./http/subscribe";
import { createNewsletterUnsubscribeRouter } from "./http/unsubscribe";

export interface NewsletterPluginBackendContribution
  extends PluginContribution<
    "newsletter",
    ReturnType<typeof createNewsletterPluginBackendHooks>,
    NewsletterBackendRouteDefinition
  > {
  service: NewsletterPluginService;
}

export interface NewsletterPluginBackendContributionDeps
  extends NewsletterPluginServiceDeps {}

export function createNewsletterPluginBackendContribution(
  deps: NewsletterPluginBackendContributionDeps,
): NewsletterPluginBackendContribution {
  const service = createNewsletterPluginService(deps);

  return {
    service,
    module: createNewsletterPluginModule({
      async ensurePlugin(options) {
        const result = await service.ensureNewsletterPlugin(options);
        return {
          instanceId: result.instanceId,
          created: result.created,
          status: result.status,
        };
      },
      getInfo(options) {
        return service.getNewsletterInfo(options);
      },
      updateConfig(options) {
        return service.updateNewsletterConfig(options);
      },
      resendConfirmation(options) {
        return service.resendConfirmation(options);
      },
      markConfirmed(options) {
        return service.markConfirmed(options);
      },
      unsubscribeSubscriber(options) {
        return service.unsubscribeSubscriber(options);
      },
      readSummary(options) {
        return service.getNewsletterSummary(options);
      },
      readCampaigns(options) {
        return service.listCampaigns(options);
      },
      saveCampaignDraft(options) {
        return service.saveCampaignDraft(options);
      },
      deleteCampaignDraft(options) {
        return service.deleteCampaignDraft(options);
      },
      testSendCampaign(options) {
        return service.testSendCampaign(options);
      },
      sendCampaign(options) {
        return service.sendCampaign(options);
      },
      cancelCampaign(options) {
        return service.cancelCampaign(options);
      },
      readSubscribers(options) {
        return service.listSubscribers(options);
      },
      mapPublicError(context) {
        const { error } = context;
        if (
          error instanceof NewsletterPluginNotEnabledError ||
          error instanceof NewsletterCampaignNotFoundError ||
          error instanceof NewsletterCampaignStateError ||
          error instanceof NewsletterSubscriberNotFoundError ||
          error instanceof NewsletterSubscriberSuppressedError ||
          error instanceof NewsletterSignupRateLimitError ||
          error instanceof NewsletterSignupSourceHostError
        ) {
          return {
            code: "BAD_REQUEST" as const,
            message: error.message,
          };
        }
        if (
          error instanceof NewsletterConfirmationDeliveryError ||
          error instanceof NewsletterCampaignDeliveryError
        ) {
          return {
            code: "INTERNAL_SERVER_ERROR" as const,
            message: error.message,
          };
        }
        return null;
      },
    }),
    hooks: createNewsletterPluginBackendHooks({
      db: deps.db,
      tables: {
        newsletterSubscriber: deps.tables.newsletterSubscriber,
        newsletterActionToken: deps.tables.newsletterActionToken,
        newsletterCampaign: deps.tables.newsletterCampaign,
        newsletterCampaignDelivery: deps.tables.newsletterCampaignDelivery,
      },
      processQueuedCampaigns() {
        return service.processQueuedCampaigns();
      },
    }),
    publicRoutes: [
      {
        routeId: "newsletter.subscribe",
        mountPath: "/plugins",
        createRouter: (routeDeps) =>
          createNewsletterSubscribeRouter({
            upload: routeDeps.upload,
            service,
          }),
      },
      {
        routeId: "newsletter.confirm",
        mountPath: "/plugins",
        createRouter: () =>
          createNewsletterConfirmRouter({
            service,
          }),
      },
      {
        routeId: "newsletter.unsubscribe",
        mountPath: "/plugins",
        createRouter: () =>
          createNewsletterUnsubscribeRouter({
            service,
          }),
      },
    ],
  };
}
