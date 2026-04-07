import type {
  PluginCliInfoContractPayload,
  PluginCliModule,
} from "@vivd/shared/types";

type AnalyticsCliInfoResponse = {
  pluginId: "analytics";
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  usage: {
    scriptEndpoint: string;
    trackEndpoint: string;
    eventTypes: string[];
    respectDoNotTrack: boolean;
    captureQueryString: boolean;
    enableClientTracking: boolean;
  };
  instructions: string[];
};

function formatStatusLine(label: string, value: string | null | undefined): string {
  return `${label}: ${value == null || value === "" ? "n/a" : value}`;
}

function formatInstructionLines(instructions: string[]): string[] {
  if (instructions.length === 0) return ["- none"];
  return instructions.map((instruction) => `- ${instruction}`);
}

function toAnalyticsCliInfoResponse(
  info: PluginCliInfoContractPayload,
): AnalyticsCliInfoResponse {
  const usage = (info.usage ?? {}) as Partial<AnalyticsCliInfoResponse["usage"]>;
  return {
    pluginId: "analytics",
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    usage: {
      scriptEndpoint:
        typeof usage.scriptEndpoint === "string" ? usage.scriptEndpoint : "",
      trackEndpoint:
        typeof usage.trackEndpoint === "string" ? usage.trackEndpoint : "",
      eventTypes: Array.isArray(usage.eventTypes)
        ? usage.eventTypes.filter((value): value is string => typeof value === "string")
        : [],
      respectDoNotTrack: usage.respectDoNotTrack === true,
      captureQueryString: usage.captureQueryString === true,
      enableClientTracking: usage.enableClientTracking === true,
    },
    instructions: info.instructions,
  };
}

function formatAnalyticsPluginReport(input: AnalyticsCliInfoResponse): string {
  return [
    `Entitled: ${input.entitled ? "yes" : "no"} (${input.entitlementState})`,
    `Enabled: ${input.enabled ? "yes" : "no"}`,
    formatStatusLine("Instance", input.instanceId),
    formatStatusLine("Status", input.status),
    formatStatusLine("Public token", input.publicToken),
    `Script endpoint: ${input.usage.scriptEndpoint || "n/a"}`,
    `Track endpoint: ${input.usage.trackEndpoint || "n/a"}`,
    `Event types: ${
      input.usage.eventTypes.length > 0 ? input.usage.eventTypes.join(", ") : "none"
    }`,
    `Respect DNT: ${input.usage.respectDoNotTrack ? "yes" : "no"}`,
    `Capture query string: ${input.usage.captureQueryString ? "yes" : "no"}`,
    `Client tracking: ${input.usage.enableClientTracking ? "enabled" : "disabled"}`,
    "Instructions:",
    ...formatInstructionLines(input.instructions),
  ].join("\n");
}

export const analyticsCliModule: PluginCliModule = {
  pluginId: "analytics",
  genericRendererModes: {
    info: true,
  },
  aliases: [
    {
      tokens: ["analytics", "info"],
      target: { kind: "info" },
    },
  ],
  help: {
    topic: "analytics",
    summaryLines: ["vivd plugins analytics info"],
    lines: [
      "Preferred generic equivalents:",
      "vivd plugins info analytics",
      "vivd plugins config show analytics",
      "vivd plugins config template analytics",
      "vivd plugins config apply analytics --file config.json",
      "Compatibility alias:",
      "vivd plugins analytics info",
      "Analytics info shows the script endpoint, public token, and integration guidance.",
    ],
  },
  renderInfo(info) {
    const data = toAnalyticsCliInfoResponse(info);
    return {
      data,
      human: formatAnalyticsPluginReport(data),
    };
  },
};
