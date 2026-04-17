import { randomUUID } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import type {
  TableBookingAvailabilityInput,
  TableBookingCancelByTokenResult,
  TableBookingCancelPreviewResult,
  TableBookingReservationMutationInput,
  TableBookingReservationMutationResult,
} from "./ports";
import {
  formatDateTimeLabelInTimeZone,
  formatTimeInTimeZone,
  overlaps,
  resolveServicePeriodsForDate,
  zonedDateTimeToUtc,
} from "./schedule";
import {
  canGuestCancelReservation,
  validateBookingPayload,
  validateBookingWindow,
} from "./serviceCapacity";
import type { TableBookingServiceContext } from "./serviceContext";
import {
  TableBookingCapacityError,
  TableBookingPluginNotEnabledError,
  TableBookingSourceHostError,
  TableBookingValidationError,
} from "./serviceErrors";
import { sendBookingCreatedEmails, sendGuestCancellationEmails } from "./serviceNotifications";
import {
  parseRefererParts,
  resolveDefaultSuccessRedirectTarget,
  resolveEffectiveRedirectHosts,
  resolveEffectiveSourceHosts,
  resolveRedirectTarget,
  withRedirectParam,
} from "./serviceSourceHosts";
import {
  DUPLICATE_WINDOW_MS,
  hashClientIp,
  normalizeEmailAddress,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTableBookingConfig,
  TOKEN_RATE_LIMIT_PER_MINUTE,
  IP_RATE_LIMIT_PER_HOUR,
  getServiceDateFallback,
  toDateTimeDisplayString,
} from "./serviceShared";
import type { ReservationRow } from "./serviceTypes";

export function createTableBookingPublicService(
  context: TableBookingServiceContext,
) {
  const {
    db,
    tables,
    deps,
    hostUtils,
    inferSourceHosts,
    pluginEntitlementService,
    projectPluginInstanceService,
  } = context;
  const { tableBookingReservation, tableBookingActionToken } = tables;

  return {
    async listAvailability(options: TableBookingAvailabilityInput) {
      const pluginInstance = await context.loadPluginInstanceByToken(options.token);
      if (!pluginInstance) {
        throw new TableBookingPluginNotEnabledError();
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      const inferredSourceHosts = await inferSourceHosts({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config,
        inferredSourceHosts,
        deps,
      );
      if (
        effectiveSourceHosts.length > 0 &&
        !hostUtils.isHostAllowed(options.sourceHost, effectiveSourceHosts)
      ) {
        throw new TableBookingSourceHostError();
      }

      return {
        slots: await context.buildAvailableSlots({
          pluginInstance,
          config,
          date: options.date,
          partySize: options.partySize,
          now: new Date(),
        }),
      };
    },

    async createReservation(options: TableBookingReservationMutationInput): Promise<{
      redirectTarget: string | null;
      result: TableBookingReservationMutationResult;
    }> {
      const pluginInstance = await context.loadPluginInstanceByToken(options.token);
      if (!pluginInstance) {
        throw new TableBookingPluginNotEnabledError();
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      validateBookingPayload({ input: options, config });

      const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
        pluginId: "table_booking",
      });
      if (entitlement.state !== "enabled") {
        throw new TableBookingPluginNotEnabledError();
      }

      const inferredSourceHosts = await inferSourceHosts({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      const effectiveSourceHosts = resolveEffectiveSourceHosts(
        config,
        inferredSourceHosts,
        deps,
      );
      if (
        effectiveSourceHosts.length > 0 &&
        !hostUtils.isHostAllowed(options.sourceHost, effectiveSourceHosts)
      ) {
        throw new TableBookingSourceHostError();
      }

      const redirectHosts = resolveEffectiveRedirectHosts(
        config,
        effectiveSourceHosts,
        deps,
      );
      const successRedirectTarget =
        resolveRedirectTarget(options.redirect, redirectHosts, deps) ??
        resolveDefaultSuccessRedirectTarget({
          rawReferer: options.referer,
          rawOrigin: options.origin,
          allowlist: redirectHosts,
          deps,
        });

      const now = new Date();
      const ipHash = hashClientIp(options.clientIp);
      const recentByToken = await context.countRecentRequests({
        pluginInstanceId: pluginInstance.id,
        since: new Date(now.getTime() - 60_000),
        ipHash: null,
      });
      if (recentByToken.tokenCount >= TOKEN_RATE_LIMIT_PER_MINUTE) {
        throw new TableBookingValidationError(
          "Too many booking attempts. Please try again later.",
        );
      }

      const recentByIp = ipHash
        ? await context.countRecentRequests({
            pluginInstanceId: pluginInstance.id,
            since: new Date(now.getTime() - 60 * 60 * 1000),
            ipHash,
          })
        : { tokenCount: 0, ipCount: 0 };
      if (recentByIp.ipCount >= IP_RATE_LIMIT_PER_HOUR) {
        throw new TableBookingValidationError(
          "Too many booking attempts. Please try again later.",
        );
      }

      await context.enforceMonthlyLimit({ pluginInstance, entitlement });

      const candidateSlots = await context.buildAvailableSlots({
        pluginInstance,
        config,
        date: options.date,
        partySize: options.partySize,
        now,
      });
      const selectedSlot = candidateSlots.find((slot) => slot.time === options.time);
      if (!selectedSlot) {
        throw new TableBookingCapacityError();
      }

      const matchingPeriod = resolveServicePeriodsForDate(config, options.date).find(
        (period) =>
          period.startTime <= options.time &&
          period.endTime > options.time &&
          (!period.maxPartySize || options.partySize <= period.maxPartySize),
      );
      if (!matchingPeriod) {
        throw new TableBookingCapacityError();
      }

      const serviceStartAt = zonedDateTimeToUtc(
        options.date,
        options.time,
        config.timezone,
      );
      const durationMinutes =
        matchingPeriod.durationMinutes ?? config.defaultDurationMinutes;
      const serviceEndAt = new Date(serviceStartAt.getTime() + durationMinutes * 60_000);

      validateBookingWindow({
        config,
        date: options.date,
        startAt: serviceStartAt,
        now,
      });

      const normalizedGuestName = normalizeRequiredText(options.name, 120);
      const normalizedGuestEmail = normalizeRequiredText(options.email, 320);
      const normalizedGuestEmailLower = normalizeEmailAddress(options.email);
      const normalizedGuestPhone = normalizeRequiredText(options.phone, 64);
      const normalizedNotes = normalizeOptionalText(options.notes, 2000);
      const referer = parseRefererParts(options.referer);

      const duplicateSince = new Date(now.getTime() - DUPLICATE_WINDOW_MS);
      const projectTitle = await context.readProjectTitle({
        organizationId: pluginInstance.organizationId,
        projectSlug: pluginInstance.projectSlug,
      });
      const endpoints = await context.resolvePublicEndpoints();

      const result = await db.transaction(async (tx: any) => {
        const existingRows = await tx
          .select()
          .from(tableBookingReservation)
          .where(
            and(
              eq(tableBookingReservation.pluginInstanceId, pluginInstance.id),
              eq(tableBookingReservation.serviceStartAt, serviceStartAt),
              eq(
                tableBookingReservation.guestEmailNormalized,
                normalizedGuestEmailLower,
              ),
              gte(tableBookingReservation.createdAt, duplicateSince),
            ),
          )
          .limit(1);
        const existing = existingRows[0] as ReservationRow | undefined;
        if (
          existing &&
          (existing.status === "confirmed" ||
            existing.status === "completed" ||
            existing.status === "no_show")
        ) {
          return {
            reservation: existing,
            alreadyConfirmed: true,
            rawCancelToken: null,
          };
        }

        const sameDayReservations = await context.listReservationsForDate(
          tx,
          pluginInstance.id,
          options.date,
        );
        const overlappingCovers = sameDayReservations
          .filter((reservation) => reservation.status === "confirmed")
          .filter((reservation) =>
            overlaps(
              reservation.serviceStartAt,
              reservation.serviceEndAt,
              serviceStartAt,
              serviceEndAt,
            ),
          )
          .reduce((sum, reservation) => sum + reservation.partySize, 0);
        if (overlappingCovers + options.partySize > matchingPeriod.maxConcurrentCovers) {
          throw new TableBookingCapacityError();
        }

        const reservationId = randomUUID();
        const [inserted] = await tx
          .insert(tableBookingReservation)
          .values({
            id: reservationId,
            organizationId: pluginInstance.organizationId,
            projectSlug: pluginInstance.projectSlug,
            pluginInstanceId: pluginInstance.id,
            status: "confirmed",
            serviceDate: options.date,
            serviceStartAt,
            serviceEndAt,
            partySize: options.partySize,
            guestName: normalizedGuestName,
            guestEmail: normalizedGuestEmail,
            guestEmailNormalized: normalizedGuestEmailLower,
            guestPhone: normalizedGuestPhone,
            notes: normalizedNotes,
            sourceChannel: "online",
            sourceHost: options.sourceHost,
            sourcePath: referer.path,
            referrerHost: referer.host,
            utmSource: referer.utmSource,
            utmMedium: referer.utmMedium,
            utmCampaign: referer.utmCampaign,
            lastIpHash: ipHash,
            createdByUserId: null,
            updatedByUserId: null,
            confirmedAt: now,
          })
          .returning();

        const rawCancelToken = await context.ensureGuestCancelToken({
          tx,
          reservationId,
          organizationId: pluginInstance.organizationId,
          projectSlug: pluginInstance.projectSlug,
          serviceEndAt,
        });

        return {
          reservation: inserted as ReservationRow,
          alreadyConfirmed: false,
          rawCancelToken,
        };
      });

      if (!result.alreadyConfirmed && result.rawCancelToken) {
        const cancelUrl = withRedirectParam(
          `${endpoints.cancelEndpoint}?token=${encodeURIComponent(result.rawCancelToken)}`,
          successRedirectTarget,
        );
        await sendBookingCreatedEmails(deps, {
          projectTitle,
          config,
          reservation: result.reservation,
          cancelUrl,
        });
      }

      return {
        redirectTarget: successRedirectTarget,
        result: {
          bookingId: result.reservation.id,
          status: result.alreadyConfirmed ? "already_confirmed" : "confirmed",
          serviceDate: result.reservation.serviceDate,
          time: formatTimeInTimeZone(result.reservation.serviceStartAt, config.timezone),
          partySize: result.reservation.partySize,
        },
      };
    },

    async getCancelPreview(options: {
      token: string;
    }): Promise<TableBookingCancelPreviewResult> {
      const row = await context.findReservationByGuestToken(options.token);
      if (!row) return { status: "invalid" };
      if (row.tokenUsedAt) {
        return {
          status: "already_cancelled",
          reservation: {
            guestName: row.reservation.guestName,
            serviceDate: row.reservation.serviceDate,
            bookingDateTimeLabel: toDateTimeDisplayString(
              row.reservation.serviceStartAt,
              getServiceDateFallback(row.reservation.serviceDate),
            ),
            partySize: row.reservation.partySize,
          },
        };
      }
      if (row.tokenExpiresAt < new Date()) return { status: "expired" };

      const config = normalizeTableBookingConfig(
        (
          await projectPluginInstanceService.getPluginInstance({
            organizationId: row.reservation.organizationId,
            projectSlug: row.reservation.projectSlug,
            pluginId: "table_booking",
          })
        )?.configJson ?? {},
      );
      const bookingDateTimeLabel = formatDateTimeLabelInTimeZone(
        row.reservation.serviceStartAt,
        config.timezone,
      );

      if (
        row.reservation.status === "cancelled_by_guest" ||
        row.reservation.status === "cancelled_by_staff"
      ) {
        return {
          status: "already_cancelled",
          reservation: {
            guestName: row.reservation.guestName,
            serviceDate: row.reservation.serviceDate,
            bookingDateTimeLabel,
            partySize: row.reservation.partySize,
          },
        };
      }

      if (!canGuestCancelReservation(row.reservation, config, new Date())) {
        return {
          status: "cutoff_passed",
          reservation: {
            guestName: row.reservation.guestName,
            serviceDate: row.reservation.serviceDate,
            bookingDateTimeLabel,
            partySize: row.reservation.partySize,
          },
        };
      }

      return {
        status: "confirm",
        reservation: {
          guestName: row.reservation.guestName,
          serviceDate: row.reservation.serviceDate,
          bookingDateTimeLabel,
          partySize: row.reservation.partySize,
        },
      };
    },

    async cancelByToken(options: {
      token: string;
      redirect: string | null;
    }): Promise<TableBookingCancelByTokenResult> {
      const row = await context.findReservationByGuestToken(options.token);
      if (!row) return { status: "invalid" };
      if (row.tokenUsedAt) return { status: "already_cancelled" };
      if (row.tokenExpiresAt < new Date()) return { status: "expired" };

      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: row.reservation.organizationId,
        projectSlug: row.reservation.projectSlug,
        pluginId: "table_booking",
      });
      const config = normalizeTableBookingConfig(pluginInstance?.configJson ?? {});
      if (!canGuestCancelReservation(row.reservation, config, new Date())) {
        return { status: "cutoff_passed" };
      }

      const [updated] = await db
        .update(tableBookingReservation)
        .set({
          status: "cancelled_by_guest",
          cancelledAt: new Date(),
          cancelledBy: "guest",
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, row.reservation.id))
        .returning();

      await db
        .update(tableBookingActionToken)
        .set({
          usedAt: new Date(),
        })
        .where(eq(tableBookingActionToken.id, row.tokenId));

      const projectTitle = await context.readProjectTitle({
        organizationId: row.reservation.organizationId,
        projectSlug: row.reservation.projectSlug,
      });
      if (updated) {
        await sendGuestCancellationEmails(deps, {
          projectTitle,
          config,
          reservation: updated as ReservationRow,
          cancelledBy: "guest",
        });
      }

      const inferredSourceHosts = await inferSourceHosts({
        organizationId: row.reservation.organizationId,
        projectSlug: row.reservation.projectSlug,
      });
      const redirectTarget = resolveRedirectTarget(
        options.redirect,
        resolveEffectiveRedirectHosts(
          config,
          resolveEffectiveSourceHosts(config, inferredSourceHosts, deps),
          deps,
        ),
        deps,
      );

      return {
        status: "cancelled",
        redirectTarget,
      };
    },
  };
}
