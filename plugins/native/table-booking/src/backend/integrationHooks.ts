import { and, eq, gte, sql } from "drizzle-orm";
import type { TableBookingPluginIntegrationHooksDeps } from "./ports";

export function createTableBookingPluginBackendHooks(
  deps: TableBookingPluginIntegrationHooksDeps,
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
          organizationId: deps.tables.tableBookingReservation.organizationId,
          projectSlug: deps.tables.tableBookingReservation.projectSlug,
          count: sql<number>`count(*)`,
        })
        .from(deps.tables.tableBookingReservation)
        .where(
          and(
            gte(
              deps.tables.tableBookingReservation.createdAt,
              options.startedAt,
            ),
            options.organizationId
              ? eq(
                  deps.tables.tableBookingReservation.organizationId,
                  options.organizationId,
                )
              : undefined,
          ),
        )
        .groupBy(
          deps.tables.tableBookingReservation.organizationId,
          deps.tables.tableBookingReservation.projectSlug,
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
      const updatedReservations = await options.tx
        .update(deps.tables.tableBookingReservation)
        .set({ projectSlug: options.newSlug, updatedAt: new Date() })
        .where(
          and(
            eq(
              deps.tables.tableBookingReservation.organizationId,
              options.organizationId,
            ),
            eq(deps.tables.tableBookingReservation.projectSlug, options.oldSlug),
          ),
        )
        .returning({ id: deps.tables.tableBookingReservation.id });

      const updatedTokens = await options.tx
        .update(deps.tables.tableBookingActionToken)
        .set({ projectSlug: options.newSlug })
        .where(
          and(
            eq(
              deps.tables.tableBookingActionToken.organizationId,
              options.organizationId,
            ),
            eq(deps.tables.tableBookingActionToken.projectSlug, options.oldSlug),
          ),
        )
        .returning({ id: deps.tables.tableBookingActionToken.id });

      const updatedCapacityAdjustments = await options.tx
        .update(deps.tables.tableBookingCapacityAdjustment)
        .set({ projectSlug: options.newSlug, updatedAt: new Date() })
        .where(
          and(
            eq(
              deps.tables.tableBookingCapacityAdjustment.organizationId,
              options.organizationId,
            ),
            eq(
              deps.tables.tableBookingCapacityAdjustment.projectSlug,
              options.oldSlug,
            ),
          ),
        )
        .returning({ id: deps.tables.tableBookingCapacityAdjustment.id });

      return (
        updatedReservations.length +
        updatedTokens.length +
        updatedCapacityAdjustments.length
      );
    },
  };
}
