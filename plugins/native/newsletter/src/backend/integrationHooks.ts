import { and, eq, gte, sql } from "drizzle-orm";
import type { NewsletterPluginIntegrationHooksDeps } from "./ports";

const DEFAULT_NEWSLETTER_CAMPAIGN_POLL_INTERVAL_MS = 15_000;

function startNewsletterCampaignProcessingJob(
  processQueuedCampaigns: () => Promise<number>,
): () => void {
  let running = false;

  const runTick = async () => {
    if (running) return;
    running = true;
    try {
      await processQueuedCampaigns();
    } catch (error) {
      console.error(
        "[NewsletterCampaigns] Failed to process queued campaign deliveries:",
        error,
      );
    } finally {
      running = false;
    }
  };

  void runTick();

  const timer = setInterval(() => {
    void runTick();
  }, DEFAULT_NEWSLETTER_CAMPAIGN_POLL_INTERVAL_MS);

  return () => {
    clearInterval(timer);
  };
}

export function createNewsletterPluginBackendHooks(
  deps: NewsletterPluginIntegrationHooksDeps,
) {
  return {
    async listProjectUsageCounts(options: {
      organizationId?: string;
      startedAt: Date;
    }): Promise<Array<{
      organizationId: string;
      projectSlug: string;
      count: number;
    }>> {
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

    async renameProjectSlugData(options: {
      tx: {
        update(table: any): any;
      };
      organizationId: string;
      oldSlug: string;
      newSlug: string;
    }): Promise<number> {
      const updatedSubscribers = await options.tx
        .update(deps.tables.newsletterSubscriber)
        .set({ projectSlug: options.newSlug, updatedAt: new Date() })
        .where(
          and(
            eq(
              deps.tables.newsletterSubscriber.organizationId,
              options.organizationId,
            ),
            eq(deps.tables.newsletterSubscriber.projectSlug, options.oldSlug),
          ),
        )
        .returning({ id: deps.tables.newsletterSubscriber.id });

      const updatedActionTokens = await options.tx
        .update(deps.tables.newsletterActionToken)
        .set({ projectSlug: options.newSlug })
        .where(
          and(
            eq(
              deps.tables.newsletterActionToken.organizationId,
              options.organizationId,
            ),
            eq(deps.tables.newsletterActionToken.projectSlug, options.oldSlug),
          ),
        )
        .returning({ id: deps.tables.newsletterActionToken.id });

      const updatedCampaigns = await options.tx
        .update(deps.tables.newsletterCampaign)
        .set({ projectSlug: options.newSlug, updatedAt: new Date() })
        .where(
          and(
            eq(
              deps.tables.newsletterCampaign.organizationId,
              options.organizationId,
            ),
            eq(deps.tables.newsletterCampaign.projectSlug, options.oldSlug),
          ),
        )
        .returning({ id: deps.tables.newsletterCampaign.id });

      const updatedDeliveries = await options.tx
        .update(deps.tables.newsletterCampaignDelivery)
        .set({ projectSlug: options.newSlug, updatedAt: new Date() })
        .where(
          and(
            eq(
              deps.tables.newsletterCampaignDelivery.organizationId,
              options.organizationId,
            ),
            eq(
              deps.tables.newsletterCampaignDelivery.projectSlug,
              options.oldSlug,
            ),
          ),
        )
        .returning({ id: deps.tables.newsletterCampaignDelivery.id });

      return (
        updatedSubscribers.length +
        updatedActionTokens.length +
        updatedCampaigns.length +
        updatedDeliveries.length
      );
    },

    startBackgroundJobs() {
      if (!deps.processQueuedCampaigns) return;
      return startNewsletterCampaignProcessingJob(deps.processQueuedCampaigns);
    },
  };
}
