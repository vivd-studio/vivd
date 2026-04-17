import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { TableBookingPluginConfig } from "./config";
import {
  getTableBookingAvailabilityEndpoint,
  getTableBookingBookEndpoint,
  getTableBookingCancelEndpoint,
} from "./publicApi";
import type {
  TableBookingPluginInstanceRow,
  TableBookingPluginServiceDeps,
  TableBookingSourceChannel,
} from "./ports";
import {
  formatDateInTimeZone,
  listCandidateSlots,
  overlaps,
} from "./schedule";
import {
  getEffectiveCapacityForRange,
  startOfUtcMonth,
  validateBookingWindow,
  validateAvailabilityInput,
} from "./serviceCapacity";
import {
  isMissingOperatorCapacityStorageError,
  TableBookingQuotaExceededError,
  warnMissingOperatorCapacityStorage,
} from "./serviceErrors";
import {
  CANCEL_TOKEN_TTL_MS,
  coerceDateValue,
  createRawToken,
  hashToken,
  toCount,
} from "./serviceShared";
import type {
  CapacityAdjustmentRow,
  LegacyGuestTokenLookupRow,
  LegacyReservationRow,
  ReservationRow,
} from "./serviceTypes";
import {
  buildLegacyReservationSelection,
  toReservationRowFromLegacy,
} from "./serviceTypes";

type SummaryCounts = {
  bookingsToday: number;
  coversToday: number;
  upcomingBookings: number;
  upcomingCovers: number;
  cancelled: number;
  noShow: number;
  completed: number;
  booked: number;
};

type ReservationLookupByToken = {
  tokenId: string;
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
  reservation: ReservationRow;
};

export interface TableBookingBookingsConditionsOptions {
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
  search: string;
  startDate?: string;
  endDate?: string;
}

export interface TableBookingServiceContext {
  deps: TableBookingPluginServiceDeps;
  db: TableBookingPluginServiceDeps["db"];
  tables: TableBookingPluginServiceDeps["tables"];
  pluginEntitlementService: TableBookingPluginServiceDeps["pluginEntitlementService"];
  projectPluginInstanceService: TableBookingPluginServiceDeps["projectPluginInstanceService"];
  inferSourceHosts: TableBookingPluginServiceDeps["inferSourceHosts"];
  hostUtils: TableBookingPluginServiceDeps["hostUtils"];
  resolvePublicEndpoints(): Promise<{
    availabilityEndpoint: string;
    bookEndpoint: string;
    cancelEndpoint: string;
  }>;
  readProjectTitle(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string>;
  countRecentRequests(options: {
    pluginInstanceId: string;
    since: Date;
    ipHash: string | null;
  }): Promise<{
    tokenCount: number;
    ipCount: number;
  }>;
  selectLegacyReservations(options: {
    dbLike: {
      select(...args: any[]): any;
    };
    where: any;
    orderBy?: any[];
    limit?: number;
    offset?: number;
  }): Promise<ReservationRow[]>;
  findManyReservationsCompat(options: {
    where: any;
    orderBy?: any[];
    limit?: number;
    offset?: number;
  }): Promise<ReservationRow[]>;
  findFirstReservationCompat(options: {
    where: any;
    orderBy?: any[];
  }): Promise<ReservationRow | null>;
  loadPluginInstanceByToken(
    token: string,
  ): Promise<TableBookingPluginInstanceRow | null>;
  findReservationById(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<ReservationRow | null>;
  findReservationByGuestToken(
    token: string,
  ): Promise<ReservationLookupByToken | null>;
  listReservationsForDate(
    dbLike: {
      select(...args: any[]): any;
    },
    pluginInstanceId: string,
    serviceDate: string,
  ): Promise<ReservationRow[]>;
  listCapacityAdjustmentsForDate(
    dbLike: {
      select(...args: any[]): any;
    },
    pluginInstanceId: string,
    serviceDate: string,
  ): Promise<CapacityAdjustmentRow[]>;
  getSummaryCounts(options: {
    organizationId: string;
    projectSlug: string;
    config: TableBookingPluginConfig;
    rangeDays: 7 | 30;
  }): Promise<SummaryCounts>;
  buildAvailableSlots(options: {
    pluginInstance: TableBookingPluginInstanceRow;
    config: TableBookingPluginConfig;
    date: string;
    partySize: number;
    now: Date;
  }): Promise<Array<{ time: string; label: string }>>;
  enforceMonthlyLimit(options: {
    pluginInstance: TableBookingPluginInstanceRow;
    entitlement: Awaited<
      ReturnType<
        TableBookingPluginServiceDeps["pluginEntitlementService"]["resolveEffectiveEntitlement"]
      >
    >;
  }): Promise<void>;
  buildBookingsConditions(
    options: TableBookingBookingsConditionsOptions,
  ): any;
  ensureGuestCancelToken(options: {
    tx: any;
    reservationId: string;
    organizationId: string;
    projectSlug: string;
    serviceEndAt: Date;
  }): Promise<string>;
}

export function createTableBookingServiceContext(
  deps: TableBookingPluginServiceDeps,
): TableBookingServiceContext {
  const {
    db,
    tables,
    pluginEntitlementService,
    projectPluginInstanceService,
    getPublicPluginApiBaseUrl,
    inferSourceHosts,
    hostUtils,
  } = deps;
  const {
    tableBookingReservation,
    tableBookingActionToken,
    tableBookingCapacityAdjustment,
    projectMeta,
    projectPluginInstance,
  } = tables;

  async function resolvePublicEndpoints() {
    const baseUrl = await getPublicPluginApiBaseUrl();
    return {
      availabilityEndpoint: getTableBookingAvailabilityEndpoint(baseUrl),
      bookEndpoint: getTableBookingBookEndpoint(baseUrl),
      cancelEndpoint: getTableBookingCancelEndpoint(baseUrl),
    };
  }

  async function readProjectTitle(options: {
    organizationId: string;
    projectSlug: string;
  }): Promise<string> {
    const row = await db.query.projectMeta?.findFirst?.({
      where: and(
        eq(projectMeta.organizationId, options.organizationId),
        eq(projectMeta.slug, options.projectSlug),
      ),
      columns: {
        title: true,
      },
    });

    const title = row?.title?.trim?.();
    return title || options.projectSlug;
  }

  async function countRecentRequests(options: {
    pluginInstanceId: string;
    since: Date;
    ipHash: string | null;
  }) {
    const tokenRows = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(tableBookingReservation)
      .where(
        and(
          eq(tableBookingReservation.pluginInstanceId, options.pluginInstanceId),
          gte(tableBookingReservation.createdAt, options.since),
        ),
      );

    const ipRows =
      options.ipHash
        ? await db
            .select({
              count: sql<number>`count(*)`,
            })
            .from(tableBookingReservation)
            .where(
              and(
                eq(tableBookingReservation.pluginInstanceId, options.pluginInstanceId),
                eq(tableBookingReservation.lastIpHash, options.ipHash),
                gte(tableBookingReservation.createdAt, options.since),
              ),
            )
        : [];

    return {
      tokenCount: toCount(tokenRows[0]?.count),
      ipCount: toCount(ipRows[0]?.count),
    };
  }

  async function listReservationsForDate(
    dbLike: {
      select(...args: any[]): any;
    },
    pluginInstanceId: string,
    serviceDate: string,
  ): Promise<ReservationRow[]> {
    const rows = await dbLike
      .select(buildLegacyReservationSelection(tableBookingReservation))
      .from(tableBookingReservation)
      .where(
        and(
          eq(tableBookingReservation.pluginInstanceId, pluginInstanceId),
          eq(tableBookingReservation.serviceDate, serviceDate),
        ),
      )
      .orderBy(asc(tableBookingReservation.serviceStartAt));

    return ((rows ?? []) as LegacyReservationRow[]).map(
      toReservationRowFromLegacy,
    );
  }

  async function listCapacityAdjustmentsForDate(
    dbLike: {
      select(...args: any[]): any;
    },
    pluginInstanceId: string,
    serviceDate: string,
  ): Promise<CapacityAdjustmentRow[]> {
    try {
      return await dbLike
        .select()
        .from(tableBookingCapacityAdjustment)
        .where(
          and(
            eq(tableBookingCapacityAdjustment.pluginInstanceId, pluginInstanceId),
            eq(tableBookingCapacityAdjustment.serviceDate, serviceDate),
          ),
        )
        .orderBy(
          asc(tableBookingCapacityAdjustment.startTime),
          asc(tableBookingCapacityAdjustment.endTime),
          asc(tableBookingCapacityAdjustment.createdAt),
        );
    } catch (error) {
      if (!isMissingOperatorCapacityStorageError(error)) {
        throw error;
      }

      warnMissingOperatorCapacityStorage(error);
      return [];
    }
  }

  async function selectLegacyReservations(options: {
    dbLike: {
      select(...args: any[]): any;
    };
    where: any;
    orderBy?: any[];
    limit?: number;
    offset?: number;
  }): Promise<ReservationRow[]> {
    let query = options.dbLike
      .select(buildLegacyReservationSelection(tableBookingReservation))
      .from(tableBookingReservation)
      .where(options.where);

    if (options.orderBy?.length) {
      query = query.orderBy(...options.orderBy);
    }
    if (typeof options.limit === "number") {
      query = query.limit(options.limit);
    }
    if (typeof options.offset === "number" && options.offset > 0) {
      query = query.offset(options.offset);
    }

    const rows = (await query) as LegacyReservationRow[];
    return (rows ?? []).map(toReservationRowFromLegacy);
  }

  async function findManyReservationsCompat(options: {
    where: any;
    orderBy?: any[];
    limit?: number;
    offset?: number;
  }): Promise<ReservationRow[]> {
    try {
      const rows = (await db.query.tableBookingReservation?.findMany?.({
        where: options.where,
        orderBy: options.orderBy,
        limit: options.limit,
        offset: options.offset,
      })) as ReservationRow[] | undefined;
      return rows ?? [];
    } catch (error) {
      if (!isMissingOperatorCapacityStorageError(error)) {
        throw error;
      }

      warnMissingOperatorCapacityStorage(error);
      return selectLegacyReservations({
        dbLike: db,
        where: options.where,
        orderBy: options.orderBy,
        limit: options.limit,
        offset: options.offset,
      });
    }
  }

  async function findFirstReservationCompat(options: {
    where: any;
    orderBy?: any[];
  }): Promise<ReservationRow | null> {
    try {
      const row = (await db.query.tableBookingReservation?.findFirst?.({
        where: options.where,
        orderBy: options.orderBy,
      })) as ReservationRow | undefined;
      return row ?? null;
    } catch (error) {
      if (!isMissingOperatorCapacityStorageError(error)) {
        throw error;
      }

      warnMissingOperatorCapacityStorage(error);
      const rows = await selectLegacyReservations({
        dbLike: db,
        where: options.where,
        orderBy: options.orderBy,
        limit: 1,
      });
      return rows[0] ?? null;
    }
  }

  async function loadPluginInstanceByToken(token: string) {
    return db.query.projectPluginInstance.findFirst({
      where: and(
        eq(projectPluginInstance.publicToken, token),
        eq(projectPluginInstance.pluginId, "table_booking"),
        eq(projectPluginInstance.status, "enabled"),
      ),
    });
  }

  async function findReservationById(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<ReservationRow | null> {
    return findFirstReservationCompat({
      where: and(
        eq(tableBookingReservation.id, options.bookingId),
        eq(tableBookingReservation.organizationId, options.organizationId),
        eq(tableBookingReservation.projectSlug, options.projectSlug),
      ),
    });
  }

  async function findReservationByGuestToken(
    token: string,
  ): Promise<ReservationLookupByToken | null> {
    const tokenHash = hashToken(token);
    let rows: ReservationLookupByToken[];

    try {
      rows = (await db
        .select({
          tokenId: tableBookingActionToken.id,
          tokenExpiresAt: tableBookingActionToken.expiresAt,
          tokenUsedAt: tableBookingActionToken.usedAt,
          reservation: tableBookingReservation,
        })
        .from(tableBookingActionToken)
        .innerJoin(
          tableBookingReservation,
          eq(tableBookingActionToken.reservationId, tableBookingReservation.id),
        )
        .where(
          and(
            eq(tableBookingActionToken.kind, "guest_cancel"),
            eq(tableBookingActionToken.tokenHash, tokenHash),
          ),
        )
        .limit(1)) as ReservationLookupByToken[];
    } catch (error) {
      if (!isMissingOperatorCapacityStorageError(error)) {
        throw error;
      }

      warnMissingOperatorCapacityStorage(error);
      rows = (await db
        .select({
          tokenId: tableBookingActionToken.id,
          tokenExpiresAt: tableBookingActionToken.expiresAt,
          tokenUsedAt: tableBookingActionToken.usedAt,
          ...buildLegacyReservationSelection(tableBookingReservation),
        })
        .from(tableBookingActionToken)
        .innerJoin(
          tableBookingReservation,
          eq(tableBookingActionToken.reservationId, tableBookingReservation.id),
        )
        .where(
          and(
            eq(tableBookingActionToken.kind, "guest_cancel"),
            eq(tableBookingActionToken.tokenHash, tokenHash),
          ),
        )
        .limit(1)
        .then((result: LegacyGuestTokenLookupRow[]) =>
          result.map((row: LegacyGuestTokenLookupRow) => ({
            tokenId: row.tokenId,
            tokenExpiresAt: row.tokenExpiresAt,
            tokenUsedAt: row.tokenUsedAt,
            reservation: toReservationRowFromLegacy(row),
          })),
        )) as ReservationLookupByToken[];
    }

    return rows[0] ?? null;
  }

  async function getSummaryCounts(options: {
    organizationId: string;
    projectSlug: string;
    config: TableBookingPluginConfig;
    rangeDays: 7 | 30;
  }): Promise<SummaryCounts> {
    const now = new Date();
    const startedAt = new Date(
      now.getTime() - options.rangeDays * 24 * 60 * 60 * 1000,
    );

    const reservations = await findManyReservationsCompat({
      where: and(
        eq(tableBookingReservation.organizationId, options.organizationId),
        eq(tableBookingReservation.projectSlug, options.projectSlug),
      ),
      orderBy: [desc(tableBookingReservation.serviceStartAt)],
    });

    const today = formatDateInTimeZone(now, options.config.timezone);

    const counts: SummaryCounts = {
      bookingsToday: 0,
      coversToday: 0,
      upcomingBookings: 0,
      upcomingCovers: 0,
      cancelled: 0,
      noShow: 0,
      completed: 0,
      booked: 0,
    };

    for (const reservation of reservations) {
      const serviceStartAt = coerceDateValue(reservation.serviceStartAt);
      const cancelledAt = coerceDateValue(reservation.cancelledAt);
      const noShowAt = coerceDateValue(reservation.noShowAt);
      const completedAt = coerceDateValue(reservation.completedAt);
      const createdAt = coerceDateValue(reservation.createdAt);

      if (reservation.status === "confirmed") {
        if (reservation.serviceDate === today) {
          counts.bookingsToday += 1;
          counts.coversToday += reservation.partySize;
        }
        if (serviceStartAt && serviceStartAt >= now) {
          counts.upcomingBookings += 1;
          counts.upcomingCovers += reservation.partySize;
        }
      }

      if (
        (reservation.status === "cancelled_by_guest" ||
          reservation.status === "cancelled_by_staff") &&
        cancelledAt &&
        cancelledAt >= startedAt
      ) {
        counts.cancelled += 1;
      }
      if (reservation.status === "no_show" && noShowAt && noShowAt >= startedAt) {
        counts.noShow += 1;
      }
      if (
        reservation.status === "completed" &&
        completedAt &&
        completedAt >= startedAt
      ) {
        counts.completed += 1;
      }
      if (createdAt && createdAt >= startedAt) {
        counts.booked += 1;
      }
    }

    return counts;
  }

  async function buildAvailableSlots(options: {
    pluginInstance: TableBookingPluginInstanceRow;
    config: TableBookingPluginConfig;
    date: string;
    partySize: number;
    now: Date;
  }) {
    validateAvailabilityInput({
      date: options.date,
      partySize: options.partySize,
      config: options.config,
    });

    const candidates = listCandidateSlots({
      config: options.config,
      date: options.date,
      partySize: options.partySize,
    });
    if (candidates.length === 0) return [];

    const reservations = await listReservationsForDate(
      db,
      options.pluginInstance.id,
      options.date,
    );
    const capacityAdjustments = await listCapacityAdjustmentsForDate(
      db,
      options.pluginInstance.id,
      options.date,
    );

    return candidates
      .filter((candidate) => {
        try {
          validateBookingWindow({
            config: options.config,
            date: options.date,
            startAt: candidate.startAt,
            now: options.now,
          });
        } catch {
          return false;
        }

        const overlappingCovers = reservations
          .filter((reservation) => reservation.status === "confirmed")
          .filter((reservation) =>
            overlaps(
              reservation.serviceStartAt,
              reservation.serviceEndAt,
              candidate.startAt,
              candidate.endAt,
            ),
          )
          .reduce((sum, reservation) => sum + reservation.partySize, 0);

        const effectiveCapacity = getEffectiveCapacityForRange({
          baseCapacity: candidate.maxConcurrentCovers,
          adjustments: capacityAdjustments,
          date: options.date,
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          timeZone: options.config.timezone,
        });

        return overlappingCovers + options.partySize <= effectiveCapacity;
      })
      .map((candidate) => ({
        time: candidate.time,
        label: candidate.time,
      }));
  }

  async function enforceMonthlyLimit(options: {
    pluginInstance: TableBookingPluginInstanceRow;
    entitlement: Awaited<
      ReturnType<
        TableBookingPluginServiceDeps["pluginEntitlementService"]["resolveEffectiveEntitlement"]
      >
    >;
  }) {
    if (
      !options.entitlement.hardStop ||
      typeof options.entitlement.monthlyEventLimit !== "number" ||
      options.entitlement.monthlyEventLimit < 0
    ) {
      return;
    }

    const currentMonthRows = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(tableBookingReservation)
      .where(
        and(
          eq(tableBookingReservation.organizationId, options.pluginInstance.organizationId),
          options.entitlement.scope === "organization" ||
          options.entitlement.scope === "instance"
            ? undefined
            : eq(
                tableBookingReservation.projectSlug,
                options.pluginInstance.projectSlug,
              ),
          gte(tableBookingReservation.createdAt, startOfUtcMonth()),
        ),
      );

    if (toCount(currentMonthRows[0]?.count) >= options.entitlement.monthlyEventLimit) {
      throw new TableBookingQuotaExceededError();
    }
  }

  function buildBookingsConditions(
    options: TableBookingBookingsConditionsOptions,
  ) {
    const searchPattern = `%${options.search.replace(/\s+/g, "%")}%`;

    return and(
      eq(tableBookingReservation.organizationId, options.organizationId),
      eq(tableBookingReservation.projectSlug, options.projectSlug),
      options.status === "all"
        ? undefined
        : eq(tableBookingReservation.status, options.status),
      options.sourceChannel && options.sourceChannel !== "all"
        ? eq(tableBookingReservation.sourceChannel, options.sourceChannel)
        : undefined,
      options.startDate
        ? gte(tableBookingReservation.serviceDate, options.startDate)
        : undefined,
      options.endDate
        ? lte(tableBookingReservation.serviceDate, options.endDate)
        : undefined,
      options.search
        ? or(
            ilike(tableBookingReservation.guestName, searchPattern),
            ilike(tableBookingReservation.guestEmail, searchPattern),
            ilike(tableBookingReservation.guestPhone, searchPattern),
          )
        : undefined,
    );
  }

  async function ensureGuestCancelToken(options: {
    tx: any;
    reservationId: string;
    organizationId: string;
    projectSlug: string;
    serviceEndAt: Date;
  }) {
    const existingRows = await options.tx
      .select()
      .from(tableBookingActionToken)
      .where(
        and(
          eq(tableBookingActionToken.reservationId, options.reservationId),
          eq(tableBookingActionToken.kind, "guest_cancel"),
        ),
      )
      .limit(1);

    const existing = existingRows[0] as
      | {
          id: string;
          expiresAt: Date;
        }
      | undefined;

    const rawCancelToken = createRawToken();
    const expiresAt = new Date(
      Math.max(
        Date.now() + CANCEL_TOKEN_TTL_MS,
        options.serviceEndAt.getTime() + 24 * 60 * 60 * 1000,
      ),
    );

    if (existing) {
      await options.tx
        .update(tableBookingActionToken)
        .set({
          tokenHash: hashToken(rawCancelToken),
          expiresAt,
          usedAt: null,
        })
        .where(eq(tableBookingActionToken.id, existing.id));

      return rawCancelToken;
    }

    await options.tx.insert(tableBookingActionToken).values({
      id: randomUUID(),
      reservationId: options.reservationId,
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      kind: "guest_cancel",
      tokenHash: hashToken(rawCancelToken),
      expiresAt,
      usedAt: null,
    });

    return rawCancelToken;
  }

  return {
    deps,
    db,
    tables,
    pluginEntitlementService,
    projectPluginInstanceService,
    inferSourceHosts,
    hostUtils,
    resolvePublicEndpoints,
    readProjectTitle,
    countRecentRequests,
    selectLegacyReservations,
    findManyReservationsCompat,
    findFirstReservationCompat,
    loadPluginInstanceByToken,
    findReservationById,
    findReservationByGuestToken,
    listReservationsForDate,
    listCapacityAdjustmentsForDate,
    getSummaryCounts,
    buildAvailableSlots,
    enforceMonthlyLimit,
    buildBookingsConditions,
    ensureGuestCancelToken,
  };
}
