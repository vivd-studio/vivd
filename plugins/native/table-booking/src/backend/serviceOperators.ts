import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type {
  TableBookingCapacityAdjustmentInput,
  TableBookingCapacityAdjustmentRecord,
  TableBookingStaffReservationInput,
} from "./ports";
import { resolveServicePeriodsForDate, overlaps, zonedDateTimeToUtc } from "./schedule";
import {
  getEffectiveCapacityForRange,
  validateCapacityAdjustmentInput,
  validateStaffReservationInput,
} from "./serviceCapacity";
import type { TableBookingServiceContext } from "./serviceContext";
import {
  isMissingOperatorCapacityStorageError,
  TableBookingCapacityError,
  TableBookingPluginNotEnabledError,
  TableBookingReservationNotFoundError,
  TableBookingValidationError,
  warnMissingOperatorCapacityStorage,
} from "./serviceErrors";
import { sendBookingCreatedEmails, sendGuestCancellationEmails } from "./serviceNotifications";
import { toCapacityAdjustmentRecord } from "./serviceRecords";
import {
  normalizeEmailAddress,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeTableBookingConfig,
} from "./serviceShared";
import type { CapacityAdjustmentRow, ReservationRow } from "./serviceTypes";

export function createTableBookingOperatorService(
  context: TableBookingServiceContext,
) {
  const {
    db,
    tables,
    pluginEntitlementService,
    projectPluginInstanceService,
    deps,
  } = context;
  const { tableBookingReservation, tableBookingCapacityAdjustment } = tables;
  let operatorReservationWriteColumnsAvailablePromise: Promise<boolean> | null =
    null;

  async function supportsOperatorReservationWriteColumns() {
    if (!operatorReservationWriteColumnsAvailablePromise) {
      operatorReservationWriteColumnsAvailablePromise = (async () => {
        try {
          await db
            .select({
              sourceChannel: tableBookingReservation.sourceChannel,
              createdByUserId: tableBookingReservation.createdByUserId,
              updatedByUserId: tableBookingReservation.updatedByUserId,
            })
            .from(tableBookingReservation)
            .limit(1);
          return true;
        } catch (error) {
          if (!isMissingOperatorCapacityStorageError(error)) {
            throw error;
          }

          warnMissingOperatorCapacityStorage(error);
          return false;
        }
      })();
    }

    return operatorReservationWriteColumnsAvailablePromise;
  }

  return {
    async upsertCapacityAdjustment(
      options: TableBookingCapacityAdjustmentInput,
    ): Promise<TableBookingCapacityAdjustmentRecord> {
      validateCapacityAdjustmentInput(options);

      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        throw new TableBookingPluginNotEnabledError();
      }

      if (options.adjustmentId) {
        const existing = await db.query.tableBookingCapacityAdjustment?.findFirst?.({
          where: and(
            eq(tableBookingCapacityAdjustment.id, options.adjustmentId),
            eq(tableBookingCapacityAdjustment.organizationId, options.organizationId),
            eq(tableBookingCapacityAdjustment.projectSlug, options.projectSlug),
          ),
        });
        if (!existing) {
          throw new TableBookingValidationError("Capacity adjustment not found.");
        }

        const [updated] = await db
          .update(tableBookingCapacityAdjustment)
          .set({
            serviceDate: options.serviceDate,
            startTime: options.startTime,
            endTime: options.endTime,
            mode: options.mode,
            capacityValue:
              options.mode === "closed" ? null : options.capacityValue ?? null,
            reason: normalizeOptionalText(options.reason, 400),
            updatedByUserId: options.requestedByUserId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(tableBookingCapacityAdjustment.id, options.adjustmentId))
          .returning();

        return toCapacityAdjustmentRecord(updated as CapacityAdjustmentRow);
      }

      const [inserted] = await db
        .insert(tableBookingCapacityAdjustment)
        .values({
          id: randomUUID(),
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginInstanceId: pluginInstance.id,
          serviceDate: options.serviceDate,
          startTime: options.startTime,
          endTime: options.endTime,
          mode: options.mode,
          capacityValue:
            options.mode === "closed" ? null : options.capacityValue ?? null,
          reason: normalizeOptionalText(options.reason, 400),
          createdByUserId: options.requestedByUserId ?? null,
          updatedByUserId: options.requestedByUserId ?? null,
        })
        .returning();

      return toCapacityAdjustmentRecord(inserted as CapacityAdjustmentRow);
    },

    async deleteCapacityAdjustment(options: {
      organizationId: string;
      projectSlug: string;
      adjustmentId: string;
    }) {
      const existing = await db.query.tableBookingCapacityAdjustment?.findFirst?.({
        where: and(
          eq(tableBookingCapacityAdjustment.id, options.adjustmentId),
          eq(tableBookingCapacityAdjustment.organizationId, options.organizationId),
          eq(tableBookingCapacityAdjustment.projectSlug, options.projectSlug),
        ),
      });
      if (!existing) {
        throw new TableBookingValidationError("Capacity adjustment not found.");
      }

      await db
        .delete(tableBookingCapacityAdjustment)
        .where(eq(tableBookingCapacityAdjustment.id, options.adjustmentId));

      return { adjustmentId: options.adjustmentId };
    },

    async upsertStaffReservation(options: TableBookingStaffReservationInput) {
      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (!pluginInstance || pluginInstance.status !== "enabled") {
        throw new TableBookingPluginNotEnabledError();
      }

      const config = normalizeTableBookingConfig(pluginInstance.configJson);
      validateStaffReservationInput({ input: options, config });

      const entitlement = await pluginEntitlementService.resolveEffectiveEntitlement({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      if (entitlement.state !== "enabled") {
        throw new TableBookingPluginNotEnabledError();
      }

      const existingReservation = options.bookingId
        ? await context.findReservationById({
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            bookingId: options.bookingId,
          })
        : null;
      if (options.bookingId && !existingReservation) {
        throw new TableBookingReservationNotFoundError(options.bookingId);
      }
      if (existingReservation && existingReservation.status !== "confirmed") {
        throw new TableBookingValidationError(
          "Only confirmed bookings can be edited or rescheduled.",
        );
      }

      if (!options.bookingId) {
        await context.enforceMonthlyLimit({ pluginInstance, entitlement });
      }

      const matchingPeriod = resolveServicePeriodsForDate(config, options.date).find(
        (period) =>
          period.startTime <= options.time &&
          period.endTime > options.time &&
          (!period.maxPartySize || options.partySize <= period.maxPartySize),
      );
      if (!matchingPeriod) {
        throw new TableBookingValidationError(
          "That time is outside the configured service windows.",
        );
      }

      const serviceStartAt = zonedDateTimeToUtc(
        options.date,
        options.time,
        config.timezone,
      );
      const durationMinutes =
        matchingPeriod.durationMinutes ?? config.defaultDurationMinutes;
      const serviceEndAt = new Date(serviceStartAt.getTime() + durationMinutes * 60_000);
      const operatorReservationWriteColumnsAvailable =
        await supportsOperatorReservationWriteColumns();

      const normalizedGuestName = normalizeRequiredText(options.name, 120);
      const normalizedGuestEmail =
        normalizeOptionalText(options.email, 320) ?? "";
      const normalizedGuestEmailLower = normalizedGuestEmail
        ? normalizeEmailAddress(normalizedGuestEmail)
        : "";
      const normalizedGuestPhone =
        normalizeOptionalText(options.phone, 64) ?? "";
      const normalizedNotes = normalizeOptionalText(options.notes, 2000);
      const sendGuestNotification = Boolean(
        options.sendGuestNotification && normalizedGuestEmail,
      );
      const projectTitle = await context.readProjectTitle({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
      });
      const endpoints = await context.resolvePublicEndpoints();
      const capacityAdjustments = await context.listCapacityAdjustmentsForDate(
        db,
        pluginInstance.id,
        options.date,
      );

      const result = await db.transaction(async (tx: any) => {
        const sameDayReservations = await context.listReservationsForDate(
          tx,
          pluginInstance.id,
          options.date,
        );
        const overlappingCovers = sameDayReservations
          .filter((reservation) => reservation.status === "confirmed")
          .filter((reservation) => reservation.id !== options.bookingId)
          .filter((reservation) =>
            overlaps(
              reservation.serviceStartAt,
              reservation.serviceEndAt,
              serviceStartAt,
              serviceEndAt,
            ),
          )
          .reduce((sum, reservation) => sum + reservation.partySize, 0);
        const effectiveCapacity = getEffectiveCapacityForRange({
          baseCapacity: matchingPeriod.maxConcurrentCovers,
          adjustments: capacityAdjustments,
          date: options.date,
          startAt: serviceStartAt,
          endAt: serviceEndAt,
          timeZone: config.timezone,
        });
        if (overlappingCovers + options.partySize > effectiveCapacity) {
          throw new TableBookingCapacityError();
        }

        if (options.bookingId && existingReservation) {
          const updateValues = {
            serviceDate: options.date,
            serviceStartAt,
            serviceEndAt,
            partySize: options.partySize,
            guestName: normalizedGuestName,
            guestEmail: normalizedGuestEmail,
            guestEmailNormalized: normalizedGuestEmailLower,
            guestPhone: normalizedGuestPhone,
            notes: normalizedNotes,
            updatedAt: new Date(),
            ...(operatorReservationWriteColumnsAvailable
              ? {
                  sourceChannel: options.sourceChannel,
                  updatedByUserId: options.requestedByUserId ?? null,
                }
              : {}),
          };
          const [updated] = await tx
            .update(tableBookingReservation)
            .set(updateValues)
            .where(eq(tableBookingReservation.id, options.bookingId))
            .returning();

          const rawCancelToken = sendGuestNotification
            ? await context.ensureGuestCancelToken({
                tx,
                reservationId: options.bookingId,
                organizationId: options.organizationId,
                projectSlug: options.projectSlug,
                serviceEndAt,
              })
            : null;

          return {
            reservation: updated as ReservationRow,
            rawCancelToken,
          };
        }

        const reservationId = randomUUID();
        const insertValues = {
          id: reservationId,
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          pluginInstanceId: pluginInstance.id,
          status: "confirmed" as const,
          serviceDate: options.date,
          serviceStartAt,
          serviceEndAt,
          partySize: options.partySize,
          guestName: normalizedGuestName,
          guestEmail: normalizedGuestEmail,
          guestEmailNormalized: normalizedGuestEmailLower,
          guestPhone: normalizedGuestPhone,
          notes: normalizedNotes,
          sourceHost: null,
          sourcePath: null,
          referrerHost: null,
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          lastIpHash: null,
          confirmedAt: new Date(),
          ...(operatorReservationWriteColumnsAvailable
            ? {
                sourceChannel: options.sourceChannel,
                createdByUserId: options.requestedByUserId ?? null,
                updatedByUserId: options.requestedByUserId ?? null,
              }
            : {}),
        };
        const [inserted] = await tx
          .insert(tableBookingReservation)
          .values(insertValues)
          .returning();

        const rawCancelToken = sendGuestNotification
          ? await context.ensureGuestCancelToken({
              tx,
              reservationId,
              organizationId: options.organizationId,
              projectSlug: options.projectSlug,
              serviceEndAt,
            })
          : null;

        return {
          reservation: inserted as ReservationRow,
          rawCancelToken,
        };
      });

      if (sendGuestNotification && result.rawCancelToken) {
        const cancelUrl = `${endpoints.cancelEndpoint}?token=${encodeURIComponent(
          result.rawCancelToken,
        )}`;
        await sendBookingCreatedEmails(deps, {
          projectTitle,
          config,
          reservation: result.reservation,
          cancelUrl,
          notifyGuest: true,
          notifyStaff: false,
        });
      }

      return {
        bookingId: result.reservation.id,
        status: "confirmed" as const,
      };
    },

    async cancelBookingById(options: {
      organizationId: string;
      projectSlug: string;
      bookingId: string;
    }) {
      const reservation = await context.findReservationById(options);
      if (!reservation) {
        throw new TableBookingReservationNotFoundError(options.bookingId);
      }
      if (
        reservation.status === "cancelled_by_guest" ||
        reservation.status === "cancelled_by_staff"
      ) {
        return {
          bookingId: reservation.id,
          status: "already_cancelled" as const,
        };
      }

      const pluginInstance = await projectPluginInstanceService.getPluginInstance({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        pluginId: "table_booking",
      });
      const config = normalizeTableBookingConfig(pluginInstance?.configJson ?? {});
      const [updated] = await db
        .update(tableBookingReservation)
        .set({
          status: "cancelled_by_staff",
          cancelledAt: new Date(),
          cancelledBy: "staff",
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, reservation.id))
        .returning();

      const projectTitle = await context.readProjectTitle(options);
      if (updated) {
        await sendGuestCancellationEmails(deps, {
          projectTitle,
          config,
          reservation: updated as ReservationRow,
          cancelledBy: "staff",
        });
      }

      return {
        bookingId: reservation.id,
        status: "cancelled_by_staff" as const,
      };
    },

    async markBookingNoShow(options: {
      organizationId: string;
      projectSlug: string;
      bookingId: string;
    }) {
      const reservation = await context.findReservationById(options);
      if (!reservation) {
        throw new TableBookingReservationNotFoundError(options.bookingId);
      }

      await db
        .update(tableBookingReservation)
        .set({
          status: "no_show",
          noShowAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, reservation.id));

      return {
        bookingId: reservation.id,
        status: "no_show" as const,
      };
    },

    async markBookingCompleted(options: {
      organizationId: string;
      projectSlug: string;
      bookingId: string;
    }) {
      const reservation = await context.findReservationById(options);
      if (!reservation) {
        throw new TableBookingReservationNotFoundError(options.bookingId);
      }

      await db
        .update(tableBookingReservation)
        .set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tableBookingReservation.id, reservation.id));

      return {
        bookingId: reservation.id,
        status: "completed" as const,
      };
    },
  };
}
