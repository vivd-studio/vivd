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
  TABLE_BOOKING_SUMMARY_READ_ID,
  tableBookingAgendaReadDefinition,
  tableBookingAgendaReadInputSchema,
  tableBookingBookingsReadDefinition,
  tableBookingBookingsReadInputSchema,
  tableBookingSummaryReadDefinition,
  tableBookingSummaryReadInputSchema,
  type TableBookingAgendaPayload,
  type TableBookingBookingsPayload,
  type TableBookingSummaryPayload,
} from "../shared/summary";

export const tableBookingPluginDefinition = {
  pluginId: "table_booking",
  name: "Table Booking",
  description:
    "Accept restaurant table reservations from the live site and manage them in Vivd.",
  category: "commerce",
  version: 1,
  sortOrder: 20,
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
    ],
    reads: [
      tableBookingSummaryReadDefinition,
      tableBookingBookingsReadDefinition,
      tableBookingAgendaReadDefinition,
    ],
  },
  listUi: {
    projectPanel: "custom",
    usageLabel: "Bookings",
    limitPrompt: "Set monthly booking limit.\nLeave empty for unlimited.",
    supportsMonthlyLimit: true,
    supportsHardStop: true,
    supportsTurnstile: false,
    dashboardPath: null,
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
  if (
    options.actionId !== "cancel_booking" &&
    options.actionId !== "mark_no_show" &&
    options.actionId !== "mark_completed"
  ) {
    throw new UnsupportedPluginActionError("table_booking", options.actionId);
  }

  const bookingId = options.args[0]?.trim();
  if (!bookingId) {
    throw new PluginActionArgumentError(
      `Plugin action "${options.actionId}" requires a bookingId argument.`,
    );
  }

  const result =
    options.actionId === "cancel_booking"
      ? await runtime.cancelBookingById({
          organizationId: options.organizationId,
          projectSlug: options.projectSlug,
          bookingId,
        })
      : options.actionId === "mark_no_show"
        ? await runtime.markBookingNoShow({
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            bookingId,
          })
        : await runtime.markBookingCompleted({
            organizationId: options.organizationId,
            projectSlug: options.projectSlug,
            bookingId,
          });

  return {
    pluginId: "table_booking",
    actionId: options.actionId,
    summary:
      options.actionId === "cancel_booking"
        ? "Cancelled booking."
        : options.actionId === "mark_no_show"
          ? "Marked booking as no-show."
          : "Marked booking as completed.",
    result,
  };
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
