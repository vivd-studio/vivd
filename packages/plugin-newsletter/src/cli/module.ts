import type {
  PluginCliActionResultPayload,
  PluginCliInfoContractPayload,
  PluginCliModule,
} from "@vivd/shared/types";

type NewsletterInfoResponse = {
  pluginId: "newsletter";
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: {
    mode?: "newsletter" | "waitlist";
    collectName?: boolean;
    sourceHosts?: string[];
    redirectHostAllowlist?: string[];
  } | null;
  usage: {
    subscribeEndpoint: string;
    confirmEndpoint: string;
    unsubscribeEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
    inferredAutoSourceHosts: string[];
  };
  details: {
    counts?: {
      total: number;
      pending: number;
      confirmed: number;
      unsubscribed: number;
      bounced: number;
      complained: number;
    };
  } | null;
  instructions: string[];
};

const NEWSLETTER_CONFIG_TEMPLATE = {
  mode: "newsletter",
  collectName: false,
  sourceHosts: ["example.com"],
  redirectHostAllowlist: ["example.com"],
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatStatusLine(label: string, value: string | null | undefined): string {
  return `${label}: ${value == null || value === "" ? "n/a" : value}`;
}

function toInfoResponse(info: PluginCliInfoContractPayload): NewsletterInfoResponse {
  return {
    pluginId: "newsletter",
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config as NewsletterInfoResponse["config"],
    usage: info.usage as NewsletterInfoResponse["usage"],
    details: info.details as NewsletterInfoResponse["details"],
    instructions: info.instructions,
  };
}

function formatInstructionLines(instructions: string[]): string[] {
  if (instructions.length === 0) return ["- none"];
  return instructions.map((instruction) => `- ${instruction}`);
}

function formatNewsletterInfoReport(input: NewsletterInfoResponse): string {
  const counts = input.details?.counts;
  return [
    `Entitled: ${input.entitled ? "yes" : "no"} (${input.entitlementState})`,
    `Enabled: ${input.enabled ? "yes" : "no"}`,
    formatStatusLine("Instance", input.instanceId),
    formatStatusLine("Status", input.status),
    formatStatusLine("Public token", input.publicToken),
    `Mode: ${input.config?.mode || "newsletter"}`,
    `Collect name: ${input.config?.collectName ? "yes" : "no"}`,
    `Subscribe endpoint: ${input.usage.subscribeEndpoint}`,
    `Confirm endpoint: ${input.usage.confirmEndpoint}`,
    `Unsubscribe endpoint: ${input.usage.unsubscribeEndpoint}`,
    `Expected fields: ${input.usage.expectedFields.join(", ")}`,
    `Optional fields: ${input.usage.optionalFields.join(", ")}`,
    `Source hosts: ${
      input.usage.inferredAutoSourceHosts.length > 0
        ? input.usage.inferredAutoSourceHosts.join(", ")
        : "none"
    }`,
    `Counts: ${
      counts
        ? `total ${counts.total}, confirmed ${counts.confirmed}, pending ${counts.pending}, unsubscribed ${counts.unsubscribed}`
        : "none"
    }`,
    "Instructions:",
    ...formatInstructionLines(input.instructions),
  ].join("\n");
}

function formatNewsletterConfigReport(input: {
  projectSlug: string;
  config: NewsletterInfoResponse["config"];
  enabled: boolean;
  entitled: boolean;
}): string {
  if (!input.config) {
    return [
      `Newsletter config for ${input.projectSlug}`,
      "No saved newsletter config exists for this project yet.",
      `Plugin enabled: ${input.enabled ? "yes" : "no"}`,
      `Plugin entitled: ${input.entitled ? "yes" : "no"}`,
      "Use `vivd plugins config template newsletter` to print a valid config payload.",
    ].join("\n");
  }

  return [
    `Newsletter config for ${input.projectSlug}`,
    formatJson(input.config),
    "",
    "Apply updates with `vivd plugins config apply newsletter --file -` or a JSON file path.",
  ].join("\n");
}

function formatNewsletterActionReport(input: {
  actionId: string;
  email: string;
  status: string;
}): string {
  return [
    `Action: ${input.actionId}`,
    `Subscriber: ${input.email}`,
    `Status: ${input.status}`,
  ].join("\n");
}

export const newsletterCliModule: PluginCliModule = {
  pluginId: "newsletter",
  aliases: [
    {
      tokens: ["newsletter", "info"],
      target: { kind: "info" },
      renderMode: "plugin",
    },
    {
      tokens: ["newsletter", "config", "show"],
      target: { kind: "config_show" },
      renderMode: "plugin",
    },
    {
      tokens: ["newsletter", "config", "template"],
      target: { kind: "config_template" },
      renderMode: "plugin",
    },
    {
      tokens: ["newsletter", "config", "apply"],
      target: { kind: "config_apply" },
      renderMode: "plugin",
    },
    {
      tokens: ["newsletter", "resend"],
      target: { kind: "action", actionId: "resend_confirmation" },
      renderMode: "plugin",
    },
    {
      tokens: ["newsletter", "confirm"],
      target: { kind: "action", actionId: "mark_confirmed" },
      renderMode: "plugin",
    },
    {
      tokens: ["newsletter", "unsubscribe"],
      target: { kind: "action", actionId: "unsubscribe" },
      renderMode: "plugin",
    },
  ],
  help: {
    topic: "newsletter",
    summaryLines: ["newsletter - manage newsletter/waitlist capture for the current project"],
    lines: [
      "Newsletter / Waitlist plugin",
      "",
      "Commands:",
      "  vivd plugins info newsletter",
      "  vivd plugins snippets newsletter [html|astro]",
      "  vivd plugins config show newsletter",
      "  vivd plugins config template newsletter",
      "  vivd plugins config apply newsletter --file config.json",
      "  vivd plugins action newsletter resend_confirmation <email>",
      "  vivd plugins action newsletter mark_confirmed <email>",
      "  vivd plugins action newsletter unsubscribe <email>",
      "  vivd plugins read newsletter summary --file input.json",
      "  vivd plugins read newsletter subscribers --file input.json",
      "Use `vivd plugins snippets newsletter [html|astro]` to print the full install snippet.",
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
      human: formatNewsletterInfoReport(parsed),
    };
  },
  renderConfig({ info, projectSlug }) {
    const parsed = toInfoResponse(info);
    return {
      data: parsed.config,
      human: formatNewsletterConfigReport({
        projectSlug,
        config: parsed.config,
        enabled: parsed.enabled,
        entitled: parsed.entitled,
      }),
    };
  },
  renderConfigTemplate() {
    return {
      data: NEWSLETTER_CONFIG_TEMPLATE,
      human: [
        "Newsletter config template",
        formatJson(NEWSLETTER_CONFIG_TEMPLATE),
        "",
        "Pipe this into `vivd plugins config apply newsletter --file -` or save it to a JSON file first.",
      ].join("\n"),
    };
  },
  renderConfigUpdate({ projectSlug, info }) {
    const parsed = toInfoResponse(info);
    return {
      data: parsed.config,
      human: [
        `Newsletter plugin config updated for ${projectSlug}`,
        "Review it with `vivd plugins config show newsletter`.",
      ].join("\n"),
    };
  },
  renderAction(action: PluginCliActionResultPayload) {
    const result = action.result as { email?: string; status?: string };
    return {
      data: action.result,
      human: formatNewsletterActionReport({
        actionId: action.actionId,
        email: result.email || "n/a",
        status: result.status || "ok",
      }),
    };
  },
};
