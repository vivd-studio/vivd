import { and, eq, gte, sql } from "drizzle-orm";
import type { NewsletterPluginIntegrationHooksDeps } from "./ports";

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

      return updatedSubscribers.length + updatedActionTokens.length;
    },
  };
}
