import { and, eq, gte, sql } from "drizzle-orm";
import type {
  AnalyticsPluginIntegrationHooksDeps,
  AnalyticsPluginUsageCountRow,
} from "./ports";

export function createAnalyticsPluginBackendHooks(
  deps: AnalyticsPluginIntegrationHooksDeps,
) {
  return {
    async listProjectUsageCounts(options: {
      organizationId?: string;
      startedAt: Date;
    }): Promise<AnalyticsPluginUsageCountRow[]> {
      const rows = await deps.db
        .select({
          organizationId: deps.tables.analyticsEvent.organizationId,
          projectSlug: deps.tables.analyticsEvent.projectSlug,
          count: sql<number>`count(*)`,
        })
        .from(deps.tables.analyticsEvent)
        .where(
          and(
            gte(deps.tables.analyticsEvent.createdAt, options.startedAt),
            options.organizationId
              ? eq(deps.tables.analyticsEvent.organizationId, options.organizationId)
              : undefined,
          ),
        )
        .groupBy(
          deps.tables.analyticsEvent.organizationId,
          deps.tables.analyticsEvent.projectSlug,
        );

      return rows.map((row: any) => ({
        organizationId: row.organizationId,
        projectSlug: row.projectSlug,
        count: Number(row.count) || 0,
      }));
    },
  };
}
