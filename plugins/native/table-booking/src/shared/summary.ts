import type { PluginReadDefinition } from "@vivd/plugin-sdk";
import { z } from "zod";
import {
  tableBookingIsoDateSchema,
} from "../backend/config";

export const TABLE_BOOKING_SUMMARY_READ_ID = "summary";
export const TABLE_BOOKING_BOOKINGS_READ_ID = "bookings";
export const TABLE_BOOKING_AGENDA_READ_ID = "agenda";

export const tableBookingSummaryRangeSchema = z.union([
  z.literal(7),
  z.literal(30),
]);

export const tableBookingSummaryReadInputSchema = z.object({
  rangeDays: tableBookingSummaryRangeSchema.default(7),
});

export const tableBookingBookingStatusSchema = z.enum([
  "all",
  "confirmed",
  "cancelled_by_guest",
  "cancelled_by_staff",
  "no_show",
  "completed",
]);

export const tableBookingBookingsReadInputSchema = z.object({
  status: tableBookingBookingStatusSchema.default("all"),
  search: z.string().trim().max(160).default(""),
  startDate: tableBookingIsoDateSchema.optional(),
  endDate: tableBookingIsoDateSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const tableBookingAgendaReadInputSchema = z.object({
  rangeDays: z.number().int().min(1).max(31).default(7),
});

export type TableBookingSummaryRange = z.infer<
  typeof tableBookingSummaryRangeSchema
>;
export type TableBookingBookingFilterStatus = z.infer<
  typeof tableBookingBookingStatusSchema
>;
export type TableBookingSummaryReadInput = z.infer<
  typeof tableBookingSummaryReadInputSchema
>;
export type TableBookingBookingsReadInput = z.infer<
  typeof tableBookingBookingsReadInputSchema
>;
export type TableBookingAgendaReadInput = z.infer<
  typeof tableBookingAgendaReadInputSchema
>;

export const tableBookingSummaryReadDefinition = {
  readId: TABLE_BOOKING_SUMMARY_READ_ID,
  title: "Summary",
  description:
    "Load the high-level booking summary for a trailing day range.",
  arguments: [
    {
      name: "rangeDays",
      type: "integer",
      required: false,
      description: "Trailing day range to query.",
      allowedValues: [7, 30],
      defaultValue: 7,
    },
  ],
} satisfies PluginReadDefinition;

export const tableBookingBookingsReadDefinition = {
  readId: TABLE_BOOKING_BOOKINGS_READ_ID,
  title: "Bookings",
  description:
    "List bookings with optional status, search, date-range, limit, and offset filters.",
  arguments: [
    {
      name: "status",
      type: "string",
      required: false,
      description: "Filter by booking status.",
      allowedValues: [
        "all",
        "confirmed",
        "cancelled_by_guest",
        "cancelled_by_staff",
        "no_show",
        "completed",
      ],
      defaultValue: "all",
    },
    {
      name: "search",
      type: "string",
      required: false,
      description: "Case-insensitive guest-name, email, or phone search.",
      defaultValue: "",
    },
    {
      name: "startDate",
      type: "string",
      required: false,
      description: "Inclusive service-date lower bound in YYYY-MM-DD format.",
    },
    {
      name: "endDate",
      type: "string",
      required: false,
      description: "Inclusive service-date upper bound in YYYY-MM-DD format.",
    },
    {
      name: "limit",
      type: "integer",
      required: false,
      description: "Maximum rows to return.",
      defaultValue: 50,
    },
    {
      name: "offset",
      type: "integer",
      required: false,
      description: "Pagination offset.",
      defaultValue: 0,
    },
  ],
} satisfies PluginReadDefinition;

export const tableBookingAgendaReadDefinition = {
  readId: TABLE_BOOKING_AGENDA_READ_ID,
  title: "Agenda",
  description:
    "Load grouped upcoming confirmed bookings for a day range.",
  arguments: [
    {
      name: "rangeDays",
      type: "integer",
      required: false,
      description: "Number of upcoming days to include.",
      defaultValue: 7,
    },
  ],
} satisfies PluginReadDefinition;

export interface TableBookingSummaryPayload {
  pluginId: "table_booking";
  enabled: boolean;
  rangeDays: TableBookingSummaryRange;
  counts: {
    bookingsToday: number;
    coversToday: number;
    upcomingBookings: number;
    upcomingCovers: number;
    cancelled: number;
    noShow: number;
    completed: number;
  };
  recent: {
    booked: number;
    cancelled: number;
    noShow: number;
    completed: number;
  };
}

export interface TableBookingRecord {
  id: string;
  status: Exclude<TableBookingBookingFilterStatus, "all">;
  serviceDate: string;
  serviceStartAt: string;
  serviceEndAt: string;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  notes: string | null;
  sourceHost: string | null;
  sourcePath: string | null;
  createdAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
  noShowAt: string | null;
  canGuestCancel: boolean;
}

export interface TableBookingBookingsPayload {
  pluginId: "table_booking";
  enabled: boolean;
  status: TableBookingBookingFilterStatus;
  search: string;
  startDate: string | null;
  endDate: string | null;
  total: number;
  limit: number;
  offset: number;
  rows: TableBookingRecord[];
}

export interface TableBookingAgendaPayload {
  pluginId: "table_booking";
  enabled: boolean;
  rangeDays: number;
  groups: Array<{
    serviceDate: string;
    bookings: TableBookingRecord[];
  }>;
}
