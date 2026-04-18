import { z } from "zod";
import {
  tableBookingIsoDateSchema,
} from "../backend/config";

export const TABLE_BOOKING_SAVE_RESERVATION_ACTION_ID = "save_reservation";
export const TABLE_BOOKING_SAVE_CAPACITY_ADJUSTMENT_ACTION_ID =
  "save_capacity_adjustment";
export const TABLE_BOOKING_DELETE_CAPACITY_ADJUSTMENT_ACTION_ID =
  "delete_capacity_adjustment";
export const TABLE_BOOKING_EXPORT_BOOKINGS_ACTION_ID = "export_bookings";

export const tableBookingOperatorSourceChannelSchema = z.enum([
  "online",
  "phone",
  "walk_in",
  "staff_manual",
]);

export const tableBookingCapacityModeSchema = z.enum([
  "cover_holdback",
  "effective_capacity_override",
  "closed",
]);

export const tableBookingSaveReservationActionInputSchema = z.object({
  bookingId: z.string().trim().min(1).optional(),
  date: tableBookingIsoDateSchema,
  time: z.string().trim().min(1),
  partySize: z.number().int().max(50),
  name: z.string().trim().max(120),
  email: z.string().trim().max(320),
  phone: z.string().trim().max(64),
  notes: z.string().max(2000).optional().nullable(),
  sourceChannel: tableBookingOperatorSourceChannelSchema,
  sendGuestNotification: z.boolean().default(false),
});

export const tableBookingSaveCapacityAdjustmentActionInputSchema = z.object({
  adjustmentId: z.string().trim().min(1).optional(),
  serviceDate: tableBookingIsoDateSchema,
  startTime: z.string().trim().min(1),
  endTime: z.string().trim().min(1),
  mode: tableBookingCapacityModeSchema,
  capacityValue: z.number().int().min(1).max(500).optional().nullable(),
  reason: z.string().max(400).optional().nullable(),
});

export const tableBookingDeleteCapacityAdjustmentActionInputSchema = z.object({
  adjustmentId: z.string().trim().min(1),
});

export const tableBookingExportBookingsActionInputSchema = z.object({
  status: z.enum([
    "all",
    "confirmed",
    "cancelled_by_guest",
    "cancelled_by_staff",
    "no_show",
    "completed",
  ]).default("all"),
  sourceChannel: z.enum([
    "all",
    "online",
    "phone",
    "walk_in",
    "staff_manual",
  ]).default("all"),
  search: z.string().trim().max(160).default(""),
  startDate: tableBookingIsoDateSchema.optional(),
  endDate: tableBookingIsoDateSchema.optional(),
});

export type TableBookingSaveReservationActionInput = z.infer<
  typeof tableBookingSaveReservationActionInputSchema
>;
export type TableBookingSaveCapacityAdjustmentActionInput = z.infer<
  typeof tableBookingSaveCapacityAdjustmentActionInputSchema
>;
export type TableBookingDeleteCapacityAdjustmentActionInput = z.infer<
  typeof tableBookingDeleteCapacityAdjustmentActionInputSchema
>;
export type TableBookingExportBookingsActionInput = z.infer<
  typeof tableBookingExportBookingsActionInputSchema
>;
