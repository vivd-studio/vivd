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
  };
}
