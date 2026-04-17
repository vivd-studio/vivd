import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type {
  TableBookingDayCapacityPayload,
  TableBookingSourceChannel,
} from "./ports";
import { resolveServicePeriodsForDate, zonedDateTimeToUtc } from "./schedule";
import {
  endOfRangeFromDate,
  getEffectiveCapacityForRange,
  getPeakBookedCovers,
  overlapsTimeRangeForDate,
} from "./serviceCapacity";
import type { TableBookingServiceContext } from "./serviceContext";
import {
  isMissingOperatorCapacityStorageError,
  warnMissingOperatorCapacityStorage,
} from "./serviceErrors";
import { toBookingRecord, toCapacityAdjustmentRecord, buildBookingsCsv } from "./serviceRecords";
import { normalizeTableBookingConfig, toCount } from "./serviceShared";
import type { ReservationRow } from "./serviceTypes";
import type {
  TableBookingAgendaPayload,
  TableBookingBookingsPayload,
  TableBookingSummaryPayload,
  TableBookingRecord,
} from "../shared/summary";

function emptySummary(rangeDays: 7 | 30): TableBookingSummaryPayload {
  return {
    pluginId: "table_booking",
    enabled: false,
    rangeDays,
    counts: {
      bookingsToday: 0,
      coversToday: 0,
      upcomingBookings: 0,
      upcomingCovers: 0,
      cancelled: 0,
      noShow: 0,
      completed: 0,
    },
    recent: {
      booked: 0,
      cancelled: 0,
      noShow: 0,
      completed: 0,
    },
  };
}

export function createTableBookingReadService(
  context: TableBookingServiceContext,
) {
  const { db, tables, projectPluginInstanceService } = context;
  const { tableBookingReservation } = tables;

  return {
    async getTableBookingSummary(options: {
      organizationId: string;
      projectSlug: string;
      rangeDays: 7 | 30;
    }): Promise<TableBookingSummaryPayload> {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return emptySummary(options.rangeDays);
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const counts = await context.getSummaryCounts({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        config,
        rangeDays: options.rangeDays,
      });

      return {
        pluginId: "table_booking",
        enabled: true,
        rangeDays: options.rangeDays,
        counts: {
          bookingsToday: counts.bookingsToday,
          coversToday: counts.coversToday,
          upcomingBookings: counts.upcomingBookings,
          upcomingCovers: counts.upcomingCovers,
          cancelled: counts.cancelled,
          noShow: counts.noShow,
          completed: counts.completed,
        },
        recent: {
          booked: counts.booked,
          cancelled: counts.cancelled,
          noShow: counts.noShow,
          completed: counts.completed,
        },
      };
    },

    async listBookings(options: {
      organizationId: string;
      projectSlug: string;
      status:
        | "all"
        | "confirmed"
        | "cancelled_by_guest"
        | "cancelled_by_staff"
        | "no_show"
        | "completed";
      sourceChannel?: "all" | TableBookingSourceChannel;
      search?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    }): Promise<TableBookingBookingsPayload> {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return {
          pluginId: "table_booking",
          enabled: false,
          status: options.status,
          sourceChannel: options.sourceChannel ?? "all",
          search: options.search?.trim() || "",
          startDate: options.startDate ?? null,
          endDate: options.endDate ?? null,
          total: 0,
          limit: options.limit ?? 50,
          offset: options.offset ?? 0,
          rows: [],
        };
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const search = options.search?.trim() || "";
      const limit = Math.max(1, Math.min(200, options.limit ?? 50));
      const offset = Math.max(0, options.offset ?? 0);
      const sourceChannel = options.sourceChannel ?? "all";
      const conditions = context.buildBookingsConditions({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        status: options.status,
        sourceChannel,
        search,
        startDate: options.startDate,
        endDate: options.endDate,
      });

      let total = 0;
      let rows: ReservationRow[] = [];

      try {
        const [countRows, reservationRows] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(tableBookingReservation)
            .where(conditions),
          context.findManyReservationsCompat({
            where: conditions,
            orderBy: [
              asc(tableBookingReservation.serviceDate),
              asc(tableBookingReservation.serviceStartAt),
            ],
            limit,
            offset,
          }),
        ]);
        total = toCount(countRows[0]?.count);
        rows = reservationRows;
      } catch (error) {
        if (!isMissingOperatorCapacityStorageError(error)) {
          throw error;
        }

        warnMissingOperatorCapacityStorage(error);

        if (sourceChannel !== "all" && sourceChannel !== "online") {
          return {
            pluginId: "table_booking",
            enabled: true,
            status: options.status,
            sourceChannel,
            search,
            startDate: options.startDate ?? null,
            endDate: options.endDate ?? null,
            total: 0,
            limit,
            offset,
            rows: [],
          };
        }

        const legacyConditions = context.buildBookingsConditions({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          status: options.status,
          sourceChannel: "all",
          search,
          startDate: options.startDate,
          endDate: options.endDate,
        });
        const [countRows, reservationRows] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(tableBookingReservation)
            .where(legacyConditions),
          context.selectLegacyReservations({
            dbLike: db,
            where: legacyConditions,
            orderBy: [
              asc(tableBookingReservation.serviceDate),
              asc(tableBookingReservation.serviceStartAt),
            ],
            limit,
            offset,
          }),
        ]);
        total = toCount(countRows[0]?.count);
        rows = reservationRows;
      }

      const now = new Date();

      return {
        pluginId: "table_booking",
        enabled: true,
        status: options.status,
        sourceChannel,
        search,
        startDate: options.startDate ?? null,
        endDate: options.endDate ?? null,
        total,
        limit,
        offset,
        rows: (rows ?? []).map((row) => toBookingRecord(row, config, now)),
      };
    },

    async exportBookings(options: {
      organizationId: string;
      projectSlug: string;
      status:
        | "all"
        | "confirmed"
        | "cancelled_by_guest"
        | "cancelled_by_staff"
        | "no_show"
        | "completed";
      sourceChannel?: "all" | TableBookingSourceChannel;
      search?: string;
      startDate?: string;
      endDate?: string;
    }) {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      const filename = `${options.projectSlug}-table-bookings-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return {
          filename,
          csv: buildBookingsCsv([]),
          total: 0,
        };
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const search = options.search?.trim() || "";
      const conditions = context.buildBookingsConditions({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        status: options.status,
        sourceChannel: options.sourceChannel ?? "all",
        search,
        startDate: options.startDate,
        endDate: options.endDate,
      });
      let rows: ReservationRow[] = [];
      try {
        rows = await context.findManyReservationsCompat({
          where: conditions,
          orderBy: [
            asc(tableBookingReservation.serviceDate),
            asc(tableBookingReservation.serviceStartAt),
          ],
        });
      } catch (error) {
        if (!isMissingOperatorCapacityStorageError(error)) {
          throw error;
        }

        warnMissingOperatorCapacityStorage(error);

        if (
          options.sourceChannel &&
          options.sourceChannel !== "all" &&
          options.sourceChannel !== "online"
        ) {
          return {
            filename,
            csv: buildBookingsCsv([]),
            total: 0,
          };
        }

        const legacyConditions = context.buildBookingsConditions({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          status: options.status,
          sourceChannel: "all",
          search,
          startDate: options.startDate,
          endDate: options.endDate,
        });
        rows = await context.selectLegacyReservations({
          dbLike: db,
          where: legacyConditions,
          orderBy: [
            asc(tableBookingReservation.serviceDate),
            asc(tableBookingReservation.serviceStartAt),
          ],
        });
      }
      const now = new Date();
      const records = rows.map((row) => toBookingRecord(row, config, now));

      return {
        filename,
        csv: buildBookingsCsv(records),
        total: records.length,
      };
    },

    async getDayCapacity(options: {
      organizationId: string;
      projectSlug: string;
      serviceDate: string;
    }): Promise<TableBookingDayCapacityPayload> {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return {
          pluginId: "table_booking",
          enabled: false,
          serviceDate: options.serviceDate,
          timeZone: null,
          windows: [],
          adjustments: [],
        };
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const [reservations, adjustments] = await Promise.all([
        context.listReservationsForDate(db, pluginInstance.id, options.serviceDate),
        context.listCapacityAdjustmentsForDate(
          db,
          pluginInstance.id,
          options.serviceDate,
        ),
      ]);
      const periods = resolveServicePeriodsForDate(config, options.serviceDate);

      return {
        pluginId: "table_booking",
        enabled: true,
        serviceDate: options.serviceDate,
        timeZone: config.timezone,
        windows: periods.map((period, index) => {
          const durationMinutes =
            period.durationMinutes ?? config.defaultDurationMinutes;
          const startAt = zonedDateTimeToUtc(
            options.serviceDate,
            period.startTime,
            config.timezone,
          );
          const endAt = zonedDateTimeToUtc(
            options.serviceDate,
            period.endTime,
            config.timezone,
          );
          const windowAdjustments = adjustments.filter((adjustment) =>
            overlapsTimeRangeForDate({
              date: options.serviceDate,
              startAt,
              endAt,
              adjustment,
              timeZone: config.timezone,
            }),
          );
          const effectiveCapacity = getEffectiveCapacityForRange({
            baseCapacity: period.maxConcurrentCovers,
            adjustments,
            date: options.serviceDate,
            startAt,
            endAt,
            timeZone: config.timezone,
          });
          const bookedCovers = getPeakBookedCovers({
            reservations,
            startAt,
            endAt,
          });

          return {
            key: `${options.serviceDate}-${period.startTime}-${period.endTime}-${index}`,
            startTime: period.startTime,
            endTime: period.endTime,
            slotIntervalMinutes: period.slotIntervalMinutes,
            durationMinutes,
            baseCapacity: period.maxConcurrentCovers,
            effectiveCapacity,
            bookedCovers,
            remainingCovers: Math.max(0, effectiveCapacity - bookedCovers),
            isClosed: effectiveCapacity === 0,
            adjustments: windowAdjustments.map(toCapacityAdjustmentRecord),
          };
        }),
        adjustments: adjustments.map(toCapacityAdjustmentRecord),
      };
    },

    async getAgenda(options: {
      organizationId: string;
      projectSlug: string;
      rangeDays: number;
    }): Promise<TableBookingAgendaPayload> {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        return {
          pluginId: "table_booking",
          enabled: false,
          rangeDays: options.rangeDays,
          groups: [],
        };
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const now = new Date();
      const upperBound = endOfRangeFromDate(now, options.rangeDays);
      const rows = await context.findManyReservationsCompat({
        where: and(
          eq(tableBookingReservation.organizationId, options.organizationId),
          eq(tableBookingReservation.projectSlug, options.projectSlug),
          eq(tableBookingReservation.status, "confirmed"),
          gte(tableBookingReservation.serviceStartAt, now),
          lte(tableBookingReservation.serviceStartAt, upperBound),
        ),
        orderBy: [
          asc(tableBookingReservation.serviceDate),
          asc(tableBookingReservation.serviceStartAt),
        ],
      });

      const groups = new Map<string, TableBookingRecord[]>();
      for (const reservation of rows) {
        const current = groups.get(reservation.serviceDate) ?? [];
        current.push(toBookingRecord(reservation, config, now));
        groups.set(reservation.serviceDate, current);
      }

      return {
        pluginId: "table_booking",
        enabled: true,
        rangeDays: options.rangeDays,
        groups: Array.from(groups.entries()).map(([serviceDate, bookings]) => ({
          serviceDate,
          bookings,
        })),
      };
    },
  };
}
