import type {
  PluginCliActionResultPayload,
  PluginCliInfoContractPayload,
  PluginCliModule,
} from "@vivd/plugin-sdk";
import { tableBookingPluginDefinition } from "../backend/module";

type TableBookingInfoResponse = {
  pluginId: "table_booking";
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: {
    timezone?: string;
    sourceHosts?: string[];
    redirectHostAllowlist?: string[];
    notificationRecipientEmails?: string[];
    partySize?: {
      min: number;
      max: number;
    };
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
    counts?: {
      bookingsToday: number;
      upcomingBookings: number;
      upcomingCovers: number;
    };
    notificationRecipients?: string[];
  } | null;
  instructions: string[];
};

const TABLE_BOOKING_CONFIG_TEMPLATE = {
  timezone: "Europe/Berlin",
  sourceHosts: ["example.com"],
  redirectHostAllowlist: ["example.com"],
  notificationRecipientEmails: ["reservations@example.com"],
  partySize: {
    min: 1,
    max: 8,
  },
  leadTimeMinutes: 120,
  bookingHorizonDays: 60,
  defaultDurationMinutes: 90,
  cancellationCutoffMinutes: 120,
  collectNotes: true,
  weeklySchedule: [],
  dateOverrides: [],
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toInfoResponse(info: PluginCliInfoContractPayload): TableBookingInfoResponse {
  return {
    pluginId: "table_booking",
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config as TableBookingInfoResponse["config"],
    usage: info.usage as TableBookingInfoResponse["usage"],
    details: info.details as TableBookingInfoResponse["details"],
    instructions: info.instructions,
  };
}

function formatInstructionLines(instructions: string[]): string[] {
  if (instructions.length === 0) return ["- none"];
  return instructions.map((instruction) => `- ${instruction}`);
}

function renderInfoReport(input: TableBookingInfoResponse): string {
  return [
    `Entitled: ${input.entitled ? "yes" : "no"} (${input.entitlementState})`,
    `Enabled: ${input.enabled ? "yes" : "no"}`,
    `Instance: ${input.instanceId || "n/a"}`,
    `Status: ${input.status || "n/a"}`,
    `Public token: ${input.publicToken || "n/a"}`,
    `Timezone: ${input.config?.timezone || "n/a"}`,
    `Availability endpoint: ${input.usage.availabilityEndpoint}`,
    `Book endpoint: ${input.usage.bookEndpoint}`,
    `Cancel endpoint: ${input.usage.cancelEndpoint}`,
    `Source hosts: ${
      input.usage.inferredAutoSourceHosts.length > 0
        ? input.usage.inferredAutoSourceHosts.join(", ")
        : "none"
    }`,
    `Today: ${input.details?.counts?.bookingsToday ?? 0} bookings`,
    `Upcoming: ${input.details?.counts?.upcomingBookings ?? 0} bookings / ${
      input.details?.counts?.upcomingCovers ?? 0
    } covers`,
    "Instructions:",
    ...formatInstructionLines(input.instructions),
  ].join("\n");
}

function renderActionReport(action: {
  actionId: string;
  bookingId: string;
  status: string;
}): string {
  return [
    `Action: ${action.actionId}`,
    `Booking: ${action.bookingId}`,
    `Status: ${action.status}`,
  ].join("\n");
}

export const tableBookingCliModule: PluginCliModule = {
  pluginId: "table_booking",
  aliases: [
    {
      tokens: ["table-booking", "info"],
      target: { kind: "info" },
      renderMode: "plugin",
    },
    {
      tokens: ["table-booking", "config", "show"],
      target: { kind: "config_show" },
      renderMode: "plugin",
    },
    {
      tokens: ["table-booking", "config", "template"],
      target: { kind: "config_template" },
      renderMode: "plugin",
    },
    {
      tokens: ["table-booking", "config", "apply"],
      target: { kind: "config_apply" },
      renderMode: "plugin",
    },
    {
      tokens: ["table-booking", "cancel"],
      target: { kind: "action", actionId: "cancel_booking" },
      renderMode: "plugin",
    },
    {
      tokens: ["table-booking", "no-show"],
      target: { kind: "action", actionId: "mark_no_show" },
      renderMode: "plugin",
    },
    {
      tokens: ["table-booking", "complete"],
      target: { kind: "action", actionId: "mark_completed" },
      renderMode: "plugin",
    },
  ],
  help: {
    topic: "table-booking",
    summaryLines: ["table-booking - manage restaurant booking capture for the current project"],
    lines: [
      "Table Booking plugin",
      "",
      "Commands:",
      "  vivd plugins info table_booking",
      "  vivd plugins snippets table_booking [html|astro]",
      "  vivd plugins config show table_booking",
      "  vivd plugins config template table_booking",
      "  vivd plugins config apply table_booking --file config.json",
      "  vivd plugins action table_booking cancel_booking <bookingId>",
      "  vivd plugins action table_booking mark_no_show <bookingId>",
      "  vivd plugins action table_booking mark_completed <bookingId>",
      "  vivd plugins read table_booking summary --file input.json",
      "  vivd plugins read table_booking bookings --file input.json",
      "  vivd plugins read table_booking agenda --file input.json",
      ...(tableBookingPluginDefinition.agentHints ?? []).map((hint) => `Note: ${hint}`),
    ],
  },
  genericRendererModes: {
    info: true,
    config: true,
    configTemplate: true,
    configUpdate: true,
    action: true,
  },
  renderInfo(info) {
    const parsed = toInfoResponse(info);
    return {
      data: parsed,
      human: renderInfoReport(parsed),
    };
  },
  renderConfig(options) {
    return {
      data: options.info.config,
      human: options.info.config
        ? formatJson(options.info.config)
        : "No saved Table Booking config exists for this project yet.",
    };
  },
  renderConfigTemplate() {
    return {
      data: TABLE_BOOKING_CONFIG_TEMPLATE,
      human: formatJson(TABLE_BOOKING_CONFIG_TEMPLATE),
    };
  },
  renderConfigUpdate(options) {
    return {
      data: options.info.config,
      human: `Updated Table Booking config for ${options.projectSlug}.\n\n${formatJson(
        options.info.config ?? {},
      )}`,
    };
  },
  renderAction(action: PluginCliActionResultPayload) {
    const result = action.result as { bookingId?: string; status?: string };
    return {
      data: action,
      human: renderActionReport({
        actionId: action.actionId,
        bookingId: result.bookingId || "n/a",
        status: result.status || "ok",
      }),
    };
  },
};
