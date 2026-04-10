import type {
  PluginCliActionResultPayload,
  PluginCliInfoContractPayload,
  PluginCliModule,
} from "@vivd/shared/types";

type ContactInfoResponse = {
  pluginId: "contact_form";
  entitled: boolean;
  entitlementState: "disabled" | "enabled" | "suspended";
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  config: {
    recipientEmails?: string[];
    sourceHosts?: string[];
    redirectHostAllowlist?: string[];
    formFields?: Array<{
      key: string;
      label?: string;
      type?: string;
      required?: boolean;
      placeholder?: string;
      rows?: number;
    }>;
  } | null;
  usage: {
    submitEndpoint: string;
    expectedFields: string[];
    optionalFields: string[];
    inferredAutoSourceHosts: string[];
    turnstileEnabled: boolean;
    turnstileConfigured: boolean;
  };
  recipients: {
    options: Array<{
      email: string;
      isVerified: boolean;
      isPending: boolean;
    }>;
    pending: Array<{
      email: string;
      lastSentAt: string | null;
    }>;
  };
  instructions: string[];
};

const CONTACT_CONFIG_TEMPLATE = {
  recipientEmails: ["team@example.com"],
  sourceHosts: ["example.com"],
  redirectHostAllowlist: ["example.com"],
  formFields: [
    {
      key: "name",
      label: "Name",
      type: "text",
      required: true,
      placeholder: "",
    },
    {
      key: "email",
      label: "Email",
      type: "email",
      required: true,
      placeholder: "",
    },
    {
      key: "message",
      label: "Message",
      type: "textarea",
      required: true,
      placeholder: "",
      rows: 5,
    },
  ],
};

function formatStatusLine(label: string, value: string | null | undefined): string {
  return `${label}: ${value == null || value === "" ? "n/a" : value}`;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatInstructionLines(instructions: string[]): string[] {
  if (instructions.length === 0) return ["- none"];
  return instructions.map((instruction) => `- ${instruction}`);
}

function toContactInfoResponse(info: PluginCliInfoContractPayload): ContactInfoResponse {
  const details =
    info.details && typeof info.details === "object" ? info.details : null;
  const recipients =
    details && "recipients" in details && details.recipients
      ? details.recipients
      : { options: [], pending: [] };

  return {
    pluginId: "contact_form",
    entitled: info.entitled,
    entitlementState: info.entitlementState,
    enabled: info.enabled,
    instanceId: info.instanceId,
    status: info.status,
    publicToken: info.publicToken,
    config: info.config as ContactInfoResponse["config"],
    usage: info.usage as ContactInfoResponse["usage"],
    recipients: recipients as ContactInfoResponse["recipients"],
    instructions: info.instructions,
  };
}

function formatContactPluginReport(input: ContactInfoResponse): string {
  const configuredRecipients = input.config?.recipientEmails ?? [];
  const formFields = input.config?.formFields ?? [];
  const recipientLines =
    input.recipients.options.length > 0
      ? input.recipients.options.map((recipient) => {
          if (recipient.isVerified) {
            return `- ${recipient.email} [verified]`;
          }
          if (recipient.isPending) {
            const pending = input.recipients.pending.find(
              (row) => row.email === recipient.email,
            );
            const lastSentAt = pending?.lastSentAt ? `, last sent ${pending.lastSentAt}` : "";
            return `- ${recipient.email} [pending${lastSentAt}]`;
          }
          return `- ${recipient.email}`;
        })
      : ["- none"];

  return [
    `Entitled: ${input.entitled ? "yes" : "no"} (${input.entitlementState})`,
    `Enabled: ${input.enabled ? "yes" : "no"}`,
    formatStatusLine("Instance", input.instanceId),
    formatStatusLine("Status", input.status),
    formatStatusLine("Public token", input.publicToken),
    `Submit endpoint: ${input.usage.submitEndpoint}`,
    `Expected fields: ${input.usage.expectedFields.length > 0 ? input.usage.expectedFields.join(", ") : "none"}`,
    `Optional fields: ${input.usage.optionalFields.length > 0 ? input.usage.optionalFields.join(", ") : "none"}`,
    `Inferred auto-source hosts: ${
      input.usage.inferredAutoSourceHosts.length > 0
        ? input.usage.inferredAutoSourceHosts.join(", ")
        : "none"
    }`,
    `Turnstile: ${
      input.usage.turnstileEnabled
        ? input.usage.turnstileConfigured
          ? "enabled and configured"
          : "enabled, waiting on configuration"
        : "disabled"
    }`,
    `Configured recipients: ${configuredRecipients.length > 0 ? configuredRecipients.join(", ") : "none"}`,
    `Form fields: ${formFields.length > 0 ? formFields.map((field) => field.key).join(", ") : "none"}`,
    "Recipient directory:",
    ...recipientLines,
    "Instructions:",
    ...formatInstructionLines(input.instructions),
  ].join("\n");
}

function formatContactConfigReport(input: {
  projectSlug: string;
  config: ContactInfoResponse["config"];
  enabled: boolean;
  entitled: boolean;
}): string {
  if (!input.config) {
    return [
      `Contact config for ${input.projectSlug}`,
      "No saved contact config exists for this project yet.",
      `Plugin enabled: ${input.enabled ? "yes" : "no"}`,
      `Plugin entitled: ${input.entitled ? "yes" : "no"}`,
      "Use `vivd plugins contact config template` to print a valid config payload.",
    ].join("\n");
  }

  return [
    `Contact config for ${input.projectSlug}`,
    formatJson(input.config),
    "",
    "Apply updates with `vivd plugins contact config apply --file -` or a JSON file path.",
  ].join("\n");
}

function formatContactConfigTemplateReport(input: typeof CONTACT_CONFIG_TEMPLATE): string {
  return [
    "Contact config template",
    formatJson(input),
    "",
    "Pipe this into `vivd plugins contact config apply --file -` or save it to a JSON file first.",
  ].join("\n");
}

function formatContactConfigUpdateReport(projectSlug: string): string {
  return [
    `Contact plugin config updated for ${projectSlug}`,
    "Review it with `vivd plugins contact config show`.",
  ].join("\n");
}

function formatContactRecipientVerificationReport(input: {
  email: string;
  status:
    | "already_verified"
    | "added_verified"
    | "marked_verified"
    | "verification_sent"
    | "verification_pending";
  cooldownRemainingSeconds: number;
}): string {
  const statusLine =
    input.status === "already_verified"
      ? "already verified"
      : input.status === "added_verified"
        ? "verified and added to the contact config"
        : input.status === "marked_verified"
          ? "manually marked verified"
        : input.status === "verification_sent"
          ? "verification email sent"
          : "verification already pending";

  const lines = [`Recipient: ${input.email}`, `Status: ${statusLine}`];
  if (input.status === "verification_pending" && input.cooldownRemainingSeconds > 0) {
    lines.push(`Cooldown remaining: ${input.cooldownRemainingSeconds}s`);
  }
  return lines.join("\n");
}

export const contactFormCliModule: PluginCliModule = {
  pluginId: "contact_form",
  aliases: [
    {
      tokens: ["info", "contact"],
      target: { kind: "info" },
      renderMode: "plugin",
    },
    {
      tokens: ["contact", "info"],
      target: { kind: "info" },
      renderMode: "plugin",
    },
    {
      tokens: ["contact", "config", "show"],
      target: { kind: "config_show" },
      renderMode: "plugin",
    },
    {
      tokens: ["contact", "config", "template"],
      target: { kind: "config_template" },
      renderMode: "plugin",
    },
    {
      tokens: ["contact", "config", "apply"],
      target: { kind: "config_apply" },
      renderMode: "plugin",
    },
    {
      tokens: ["configure", "contact"],
      target: { kind: "config_apply" },
      renderMode: "plugin",
    },
    {
      tokens: ["contact", "recipients", "verify"],
      target: { kind: "action", actionId: "verify_recipient" },
      renderMode: "plugin",
    },
    {
      tokens: ["contact", "recipients", "mark-verified"],
      target: { kind: "action", actionId: "mark_recipient_verified" },
      renderMode: "plugin",
    },
    {
      tokens: ["contact", "recipients", "resend"],
      target: { kind: "action", actionId: "resend_recipient" },
      renderMode: "plugin",
    },
  ],
  help: {
    topic: "contact",
    summaryLines: [
      "vivd plugins contact info",
      "vivd plugins contact config show",
      "vivd plugins contact config template",
      "vivd plugins contact config apply --file config.json",
      "vivd plugins contact recipients verify <email>",
      "vivd plugins contact recipients mark-verified <email>",
      "vivd plugins contact recipients resend <email>",
    ],
    lines: [
      "Preferred generic equivalents:",
      "vivd plugins info contact_form",
      "vivd plugins config show contact_form",
      "vivd plugins config template contact_form",
      "vivd plugins config apply contact_form --file config.json",
      "vivd plugins action contact_form verify_recipient <email>",
      "vivd plugins action contact_form mark_recipient_verified <email>",
      "vivd plugins action contact_form resend_recipient <email>",
      "Compatibility aliases:",
      "vivd plugins contact info",
      "vivd plugins contact config show",
      "vivd plugins contact config template",
      "vivd plugins contact config apply --file config.json",
      "vivd plugins contact recipients verify <email>",
      "vivd plugins contact recipients mark-verified <email>",
      "vivd plugins contact recipients resend <email>",
      "Use --file - to read JSON config from stdin.",
      "Contact info shows submit endpoint, configured recipients, verification state, and install guidance.",
    ],
  },
  renderInfo(info) {
    const data = toContactInfoResponse(info);
    return {
      data,
      human: formatContactPluginReport(data),
    };
  },
  renderConfig({ info, projectSlug }) {
    const data = toContactInfoResponse(info);
    return {
      data: data.config,
      human: formatContactConfigReport({
        projectSlug,
        config: data.config,
        enabled: data.enabled,
        entitled: data.entitled,
      }),
    };
  },
  renderConfigTemplate() {
    return {
      data: CONTACT_CONFIG_TEMPLATE,
      human: formatContactConfigTemplateReport(CONTACT_CONFIG_TEMPLATE),
    };
  },
  renderConfigUpdate({ info, projectSlug }) {
    return {
      data: info,
      human: formatContactConfigUpdateReport(projectSlug),
    };
  },
  renderAction(action: PluginCliActionResultPayload) {
    if (
      action.actionId !== "mark_recipient_verified" &&
      action.actionId !== "verify_recipient" &&
      action.actionId !== "resend_recipient"
    ) {
      return null;
    }

    const result = action.result as {
      email: string;
      status:
        | "already_verified"
        | "added_verified"
        | "marked_verified"
        | "verification_sent"
        | "verification_pending";
      cooldownRemainingSeconds: number;
    };

    return {
      data: result,
      human: [action.summary, formatContactRecipientVerificationReport(result)].join("\n"),
    };
  },
};
