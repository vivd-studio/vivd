import type {
  PluginActionContext,
  PluginDefinition,
  PluginInfoSourcePayload,
  PluginModule,
  PluginOperationContext,
  PluginPublicErrorContext,
  PluginReadContext,
  PluginUpdateConfigContext,
  ProjectPluginActionPayload,
  ProjectPluginReadPayload,
} from "@vivd/plugin-sdk";
import {
  PluginActionArgumentError,
  UnsupportedPluginActionError,
  UnsupportedPluginReadError,
} from "@vivd/plugin-sdk";
import {
  tableBookingPluginConfigSchema,
  type TableBookingPluginConfig,
} from "./config";
import {
  TABLE_BOOKING_AGENDA_READ_ID,
  TABLE_BOOKING_BOOKINGS_READ_ID,
  TABLE_BOOKING_DAY_CAPACITY_READ_ID,
  TABLE_BOOKING_SUMMARY_READ_ID,
  tableBookingAgendaReadDefinition,
  tableBookingAgendaReadInputSchema,
  tableBookingBookingsReadDefinition,
  tableBookingBookingsReadInputSchema,
  tableBookingDayCapacityReadDefinition,
  tableBookingDayCapacityReadInputSchema,
  tableBookingSummaryReadDefinition,
  tableBookingSummaryReadInputSchema,
  type TableBookingAgendaPayload,
  type TableBookingBookingsPayload,
  type TableBookingSummaryPayload,
} from "../shared/summary";
import {
  TABLE_BOOKING_DELETE_CAPACITY_ADJUSTMENT_ACTION_ID,
  TABLE_BOOKING_EXPORT_BOOKINGS_ACTION_ID,
  TABLE_BOOKING_SAVE_CAPACITY_ADJUSTMENT_ACTION_ID,
  TABLE_BOOKING_SAVE_RESERVATION_ACTION_ID,
  tableBookingDeleteCapacityAdjustmentActionInputSchema,
  tableBookingExportBookingsActionInputSchema,
  tableBookingSaveCapacityAdjustmentActionInputSchema,
  tableBookingSaveReservationActionInputSchema,
} from "../shared/operatorActions";
import type { TableBookingDayCapacityPayload } from "./ports";

export const tableBookingPluginDefinition = {
  pluginId: "table_booking",
  kind: "native",
  name: "Table Booking",
  description:
    "Accept restaurant table reservations from the live site and manage them in Vivd.",
  category: "commerce",
  version: 1,
  sortOrder: 20,
  agentHints: [
    "Use the HTML or Astro install snippet instead of rebuilding the widget by hand.",
    "Configure weekly schedule, date overrides, notification recipients, and source hosts before launch.",
  ],
  configSchema: tableBookingPluginConfigSchema,
  defaultConfig: tableBookingPluginConfigSchema.parse({ timezone: "UTC" }),
  capabilities: {
    supportsInfo: true,
    config: {
      format: "json",
      supportsShow: true,
      supportsApply: true,
      supportsTemplate: true,
    },
    actions: [
      {
        actionId: "cancel_booking",
        title: "Cancel booking",
        description: "Cancel a booking from the restaurant admin side.",
        arguments: [
          {
            name: "bookingId",
            type: "string",
            required: true,
            description: "Booking identifier to cancel.",
          },
        ],
      },
      {
        actionId: "mark_no_show",
        title: "Mark no-show",
        description: "Mark a booking as a no-show.",
        arguments: [
          {
            name: "bookingId",
            type: "string",
            required: true,
            description: "Booking identifier to mark as no-show.",
          },
        ],
      },
      {
        actionId: "mark_completed",
        title: "Mark completed",
        description: "Mark a booking as completed.",
        arguments: [
          {
            name: "bookingId",
            type: "string",
            required: true,
            description: "Booking identifier to mark as completed.",
          },
        ],
      },
      {
        actionId: TABLE_BOOKING_SAVE_RESERVATION_ACTION_ID,
        title: "Save reservation",
        description:
          "Create or update a staff-managed reservation from the control-plane booking UI.",
        arguments: [],
      },
      {
        actionId: TABLE_BOOKING_SAVE_CAPACITY_ADJUSTMENT_ACTION_ID,
        title: "Save capacity adjustment",
        description:
          "Create or update a capacity override from the control-plane booking UI.",
        arguments: [],
      },
      {
        actionId: TABLE_BOOKING_DELETE_CAPACITY_ADJUSTMENT_ACTION_ID,
        title: "Delete capacity adjustment",
        description:
          "Delete a capacity override from the control-plane booking UI.",
        arguments: [],
      },
      {
        actionId: TABLE_BOOKING_EXPORT_BOOKINGS_ACTION_ID,
        title: "Export bookings",
        description:
          "Export filtered bookings as CSV from the control-plane booking UI.",
        arguments: [],
      },
    ],
    reads: [
      tableBookingSummaryReadDefinition,
      tableBookingBookingsReadDefinition,
      tableBookingAgendaReadDefinition,
      tableBookingDayCapacityReadDefinition,
    ],
  },
} satisfies PluginDefinition<"table_booking">;

export interface TableBookingPluginInfoSource {
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: TableBookingPluginConfig | null;
  snippets: {
    html: string;
    astro: string;
  } | null;
  usage: {
    availabilityEndpoint: string;
    bookEndpoint: string;
    cancelEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
    inferredAutoSourceHosts: string[];
  };
  details: {
    counts: {
      bookingsToday: number;
      upcomingBookings: number;
      upcomingCovers: number;
    };
    notificationRecipients: string[];
  };
  instructions: string[];
}

export interface TableBookingPluginBackendRuntime {
  ensurePlugin(options: PluginOperationContext): Promise<{
    instanceId: string;
    created: boolean;
    status: string;
  }>;
  getInfo(options: PluginOperationContext): Promise<TableBookingPluginInfoSource>;
  updateConfig(options: {
    organizationId: string;
    projectSlug: string;
    config: TableBookingPluginConfig;
  }): Promise<TableBookingPluginInfoSource>;
  cancelBookingById(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<{
    bookingId: string;
    status: "cancelled_by_staff" | "already_cancelled";
  }>;
  markBookingNoShow(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<{
    bookingId: string;
    status: "no_show";
  }>;
  markBookingCompleted(options: {
    organizationId: string;
    projectSlug: string;
    bookingId: string;
  }): Promise<{
    bookingId: string;
    status: "completed";
  }>;
  readSummary(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: 7 | 30;
  }): Promise<TableBookingSummaryPayload>;
  readBookings(options: {
    organizationId: string;
    projectSlug: string;
    status: "all" | "confirmed" | "cancelled_by_guest" | "cancelled_by_staff" | "no_show" | "completed";
    sourceChannel?: "all" | "online" | "phone" | "walk_in" | "staff_manual";
    search?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<TableBookingBookingsPayload>;
  readAgenda(options: {
    organizationId: string;
    projectSlug: string;
    rangeDays: number;
  }): Promise<TableBookingAgendaPayload>;
  readDayCapacity(options: {
    organizationId: string;
    projectSlug: string;
    serviceDate: string;
  }): Promise<TableBookingDayCapacityPayload>;
  saveReservation(options: {
    organizationId: string;
    projectSlug: string;
    bookingId?: string | null;
    date: string;
    time: string;
    partySize: number;
    name: string;
    email: string;
    phone: string;
    notes?: string | null;
    sourceChannel: "online" | "phone" | "walk_in" | "staff_manual";
    sendGuestNotification?: boolean;
    requestedByUserId?: string | null;
  }): Promise<{
    bookingId: string;
    status: "confirmed";
  }>;
  saveCapacityAdjustment(options: {
    organizationId: string;
    projectSlug: string;
    adjustmentId?: string | null;
    serviceDate: string;
    startTime: string;
    endTime: string;
    mode: "cover_holdback" | "effective_capacity_override" | "closed";
    capacityValue?: number | null;
    reason?: string | null;
    requestedByUserId?: string | null;
  }): Promise<{
    id: string;
    serviceDate: string;
    startTime: string;
    endTime: string;
    mode: "cover_holdback" | "effective_capacity_override" | "closed";
    capacityValue: number | null;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  deleteCapacityAdjustment(options: {
    organizationId: string;
    projectSlug: string;
    adjustmentId: string;
  }): Promise<{ adjustmentId: string }>;
  exportBookings(options: {
    organizationId: string;
    projectSlug: string;
    status:
      | "all"
      | "confirmed"
      | "cancelled_by_guest"
      | "cancelled_by_staff"
      | "no_show"
      | "completed";
    sourceChannel?: "all" | "online" | "phone" | "walk_in" | "staff_manual";
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    filename: string;
    csv: string;
    total: number;
  }>;
  mapPublicError?(
    context: PluginPublicErrorContext,
  ): { code: "BAD_REQUEST" | "UNAUTHORIZED" | "INTERNAL_SERVER_ERROR"; message: string } | null;
}

function toInfoPayload(
  info: TableBookingPluginInfoSource,
): PluginInfoSourcePayload {
  return {
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config,
    snippets: info.snippets,
    usage: info.usage,
    details: info.details,
    instructions: info.instructions,
  };
}

async function runAction(
  runtime: TableBookingPluginBackendRuntime,
  options: PluginActionContext,
): Promise<ProjectPluginActionPayload<"table_booking">> {
  if (options.actionId === "cancel_booking") {
    const bookingId = options.args[0]?.trim();
    if (!bookingId) {
      throw new PluginActionArgumentError(
        `Plugin action "${options.actionId}" requires a bookingId argument.`,
      );
    }

    return {
      pluginId: "table_booking",
      actionId: options.actionId,
      summary: "Cancelled booking.",
      result: await runtime.cancelBookingById({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        bookingId,
      }),
    };
  }

  if (options.actionId === "mark_no_show") {
    const bookingId = options.args[0]?.trim();
    if (!bookingId) {
      throw new PluginActionArgumentError(
        `Plugin action "${options.actionId}" requires a bookingId argument.`,
      );
    }

    return {
      pluginId: "table_booking",
      actionId: options.actionId,
      summary: "Marked booking as no-show.",
      result: await runtime.markBookingNoShow({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        bookingId,
      }),
    };
  }

  if (options.actionId === "mark_completed") {
    const bookingId = options.args[0]?.trim();
    if (!bookingId) {
      throw new PluginActionArgumentError(
        `Plugin action "${options.actionId}" requires a bookingId argument.`,
      );
    }

    return {
      pluginId: "table_booking",
      actionId: options.actionId,
      summary: "Marked booking as completed.",
      result: await runtime.markBookingCompleted({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        bookingId,
      }),
    };
  }

  if (options.actionId === TABLE_BOOKING_SAVE_RESERVATION_ACTION_ID) {
    const input = tableBookingSaveReservationActionInputSchema.parse(
      options.input ?? {},
    );

    return {
      pluginId: "table_booking",
      actionId: options.actionId,
      summary: input.bookingId
        ? "Updated reservation."
        : "Created reservation.",
      result: await runtime.saveReservation({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        bookingId: input.bookingId ?? null,
        date: input.date,
        time: input.time,
        partySize: input.partySize,
        name: input.name,
        email: input.email,
        phone: input.phone,
        notes: input.notes ?? null,
        sourceChannel: input.sourceChannel,
        sendGuestNotification: input.sendGuestNotification,
        requestedByUserId: options.requestedByUserId,
      }),
    };
  }

  if (options.actionId === TABLE_BOOKING_SAVE_CAPACITY_ADJUSTMENT_ACTION_ID) {
    const input = tableBookingSaveCapacityAdjustmentActionInputSchema.parse(
      options.input ?? {},
    );

    return {
      pluginId: "table_booking",
      actionId: options.actionId,
      summary: input.adjustmentId
        ? "Updated capacity adjustment."
        : "Saved capacity adjustment.",
      result: await runtime.saveCapacityAdjustment({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        adjustmentId: input.adjustmentId ?? null,
        serviceDate: input.serviceDate,
        startTime: input.startTime,
        endTime: input.endTime,
        mode: input.mode,
        capacityValue: input.capacityValue ?? null,
        reason: input.reason ?? null,
        requestedByUserId: options.requestedByUserId,
      }),
    };
  }

  if (options.actionId === TABLE_BOOKING_DELETE_CAPACITY_ADJUSTMENT_ACTION_ID) {
    const input = tableBookingDeleteCapacityAdjustmentActionInputSchema.parse(
      options.input ?? {},
    );

    return {
      pluginId: "table_booking",
      actionId: options.actionId,
      summary: "Deleted capacity adjustment.",
      result: await runtime.deleteCapacityAdjustment({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        adjustmentId: input.adjustmentId,
      }),
    };
  }

  if (options.actionId === TABLE_BOOKING_EXPORT_BOOKINGS_ACTION_ID) {
    const input = tableBookingExportBookingsActionInputSchema.parse(
      options.input ?? {},
    );

    return {
      pluginId: "table_booking",
      actionId: options.actionId,
      summary: "Exported bookings.",
      result: await runtime.exportBookings({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        status: input.status,
        sourceChannel: input.sourceChannel,
        search: input.search,
        startDate: input.startDate,
        endDate: input.endDate,
      }),
    };
  }

  throw new UnsupportedPluginActionError("table_booking", options.actionId);
}

async function runRead(
  runtime: TableBookingPluginBackendRuntime,
  options: PluginReadContext,
): Promise<ProjectPluginReadPayload<"table_booking">> {
  if (options.readId === TABLE_BOOKING_SUMMARY_READ_ID) {
    const input = tableBookingSummaryReadInputSchema.parse(options.input);
    return {
      pluginId: "table_booking",
      readId: options.readId,
      result: await runtime.readSummary({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        rangeDays: input.rangeDays,
      }),
    };
  }

  if (options.readId === TABLE_BOOKING_BOOKINGS_READ_ID) {
    const input = tableBookingBookingsReadInputSchema.parse(options.input);
    return {
      pluginId: "table_booking",
      readId: options.readId,
      result: await runtime.readBookings({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        status: input.status,
        sourceChannel: input.sourceChannel,
        search: input.search,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: input.limit,
        offset: input.offset,
      }),
    };
  }

  if (options.readId === TABLE_BOOKING_AGENDA_READ_ID) {
    const input = tableBookingAgendaReadInputSchema.parse(options.input);
    return {
      pluginId: "table_booking",
      readId: options.readId,
      result: await runtime.readAgenda({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        rangeDays: input.rangeDays,
      }),
    };
  }

  if (options.readId === TABLE_BOOKING_DAY_CAPACITY_READ_ID) {
    const input = tableBookingDayCapacityReadInputSchema.parse(options.input);
    return {
      pluginId: "table_booking",
      readId: options.readId,
      result: await runtime.readDayCapacity({
        organizationId: options.organizationId,
        projectSlug: options.projectSlug,
        serviceDate: input.serviceDate,
      }),
    };
  }

  throw new UnsupportedPluginReadError("table_booking", options.readId);
}

export function createTableBookingPluginModule(
  runtime: TableBookingPluginBackendRuntime,
): PluginModule<"table_booking"> {
  return {
    definition: tableBookingPluginDefinition,
    ensureInstance(options) {
      return runtime.ensurePlugin(options);
    },
    async getInfoPayload(options) {
      return toInfoPayload(await runtime.getInfo(options));
    },
    async updateConfig(options: PluginUpdateConfigContext) {
      return toInfoPayload(
        await runtime.updateConfig({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          config: tableBookingPluginConfigSchema.parse(options.config),
        }),
      );
    },
    runAction(options) {
      return runAction(runtime, options);
    },
    runRead(options) {
      return runRead(runtime, options);
    },
    mapPublicError(context: PluginPublicErrorContext) {
      return runtime.mapPublicError?.(context) ?? null;
    },
  };
}
