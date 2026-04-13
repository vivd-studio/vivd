import { and, eq, gte, sql } from "drizzle-orm";
import type { PluginModule } from "@vivd/shared/types";
import type {
  NewsletterBackendRouteDefinition,
  NewsletterPluginServiceDeps,
} from "./ports";
import { createNewsletterPluginModule } from "./module";
import {
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

export interface NewsletterPluginBackendContribution {
  service: NewsletterPluginService;
  module: PluginModule<"newsletter">;
  hooks: {
    listProjectUsageCounts(options: {
      organizationId?: string;
      startedAt: Date;
    }): Promise<Array<{
      organizationId: string;
      projectSlug: string;
      count: number;
    }>>;
  };
  publicRoutes: ReadonlyArray<NewsletterBackendRouteDefinition>;
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
      readSubscribers(options) {
        return service.listSubscribers(options);
      },
      mapPublicError(context) {
        const { error } = context;
        if (
          error instanceof NewsletterPluginNotEnabledError ||
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
        if (error instanceof NewsletterConfirmationDeliveryError) {
          return {
            code: "INTERNAL_SERVER_ERROR" as const,
            message: error.message,
          };
        }
        return null;
      },
    }),
    hooks: {
      async listProjectUsageCounts(options) {
        const rows = await deps.db
          .select({
            organizationId: deps.tables.newsletterSubscriber.organizationId,
            projectSlug: deps.tables.newsletterSubscriber.projectSlug,
            count: sql<number>`count(*)`,
          })
          .from(deps.tables.newsletterSubscriber)
          .where(
            and(
              gte(
                deps.tables.newsletterSubscriber.lastSignupAt,
                options.startedAt,
              ),
              options.organizationId
                ? eq(
                    deps.tables.newsletterSubscriber.organizationId,
                    options.organizationId,
                  )
                : undefined,
            ),
          )
          .groupBy(
            deps.tables.newsletterSubscriber.organizationId,
            deps.tables.newsletterSubscriber.projectSlug,
          );

        return rows.map((row: any) => ({
          organizationId: row.organizationId,
          projectSlug: row.projectSlug,
          count: Number(row.count) || 0,
        }));
      },
    },
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
