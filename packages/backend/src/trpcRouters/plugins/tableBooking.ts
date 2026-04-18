import { z } from "zod";
import { projectMemberProcedure, router } from "../../trpc";
import { pluginEntitlementService } from "../../services/plugins/PluginEntitlementService";
import {
  createTableBookingBackendHostService,
} from "../../services/plugins/tableBooking/hostPlugin";
import { throwPluginOperationError } from "./operations";

const tableBookingService = createTableBookingBackendHostService({
  pluginEntitlementService,
});

const tableBookingStatusSchema = z.enum([
  "all",
  "confirmed",
  "cancelled_by_guest",
  "cancelled_by_staff",
  "no_show",
  "completed",
]);

const tableBookingSourceChannelSchema = z.enum([
  "all",
  "online",
  "phone",
  "walk_in",
  "staff_manual",
]);

const tableBookingOperatorSourceChannelSchema = z.enum([
  "online",
  "phone",
  "walk_in",
  "staff_manual",
]);

const tableBookingCapacityModeSchema = z.enum([
  "cover_holdback",
  "effective_capacity_override",
  "closed",
]);

const baseBookingFilterInput = {
  slug: z.string().min(1),
  status: tableBookingStatusSchema.default("all"),
  sourceChannel: tableBookingSourceChannelSchema.default("all"),
  search: z.string().trim().max(160).default(""),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
} as const;

export const tableBookingRouter = router({
  dayCapacity: projectMemberProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        serviceDate: z.string().trim().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await tableBookingService.getDayCapacity({
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          serviceDate: input.serviceDate,
        });
      } catch (error) {
        throwPluginOperationError({
          pluginId: "table_booking",
          operation: "read",
          readId: "day_capacity",
          error,
        });
      }
    }),

  saveReservation: projectMemberProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        bookingId: z.string().trim().min(1).optional(),
        date: z.string().trim().min(1),
        time: z.string().trim().min(1),
        partySize: z.number().int().max(50),
        name: z.string().trim().max(120),
        email: z.string().trim().max(320),
        phone: z.string().trim().max(64),
        notes: z.string().max(2000).optional().nullable(),
        sourceChannel: tableBookingOperatorSourceChannelSchema,
        sendGuestNotification: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await tableBookingService.upsertStaffReservation({
          bookingId: input.bookingId ?? null,
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          date: input.date,
          time: input.time,
          partySize: input.partySize,
          name: input.name,
          email: input.email,
          phone: input.phone,
          notes: input.notes ?? null,
          sourceChannel: input.sourceChannel,
          sendGuestNotification: input.sendGuestNotification,
          requestedByUserId: ctx.session.user.id,
        });
      } catch (error) {
        throwPluginOperationError({
          pluginId: "table_booking",
          operation: "runAction",
          actionId: "save_reservation",
          error,
        });
      }
    }),

  saveCapacityAdjustment: projectMemberProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        adjustmentId: z.string().trim().min(1).optional(),
        serviceDate: z.string().trim().min(1),
        startTime: z.string().trim().min(1),
        endTime: z.string().trim().min(1),
        mode: tableBookingCapacityModeSchema,
        capacityValue: z.number().int().min(1).max(500).optional().nullable(),
        reason: z.string().max(400).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await tableBookingService.upsertCapacityAdjustment({
          adjustmentId: input.adjustmentId ?? null,
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          serviceDate: input.serviceDate,
          startTime: input.startTime,
          endTime: input.endTime,
          mode: input.mode,
          capacityValue: input.capacityValue ?? null,
          reason: input.reason ?? null,
          requestedByUserId: ctx.session.user.id,
        });
      } catch (error) {
        throwPluginOperationError({
          pluginId: "table_booking",
          operation: "runAction",
          actionId: "save_capacity_adjustment",
          error,
        });
      }
    }),

  deleteCapacityAdjustment: projectMemberProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        adjustmentId: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await tableBookingService.deleteCapacityAdjustment({
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          adjustmentId: input.adjustmentId,
        });
      } catch (error) {
        throwPluginOperationError({
          pluginId: "table_booking",
          operation: "runAction",
          actionId: "delete_capacity_adjustment",
          error,
        });
      }
    }),

  exportBookings: projectMemberProcedure
    .input(z.object(baseBookingFilterInput))
    .mutation(async ({ ctx, input }) => {
      try {
        return await tableBookingService.exportBookings({
          organizationId: ctx.organizationId!,
          projectSlug: input.slug,
          status: input.status,
          sourceChannel: input.sourceChannel,
          search: input.search,
          startDate: input.startDate,
          endDate: input.endDate,
        });
      } catch (error) {
        throwPluginOperationError({
          pluginId: "table_booking",
          operation: "read",
          readId: "export_bookings",
          error,
        });
      }
    }),
});
