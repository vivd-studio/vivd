function formatStatusLine(label: string, value: string | number | null | undefined): string {
  return `${label}: ${value == null || value === "" ? "n/a" : value}`;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatInstructionLines(instructions: string[]): string[] {
  if (instructions.length === 0) return ["- none"];
  return instructions.map((instruction) => `- ${instruction}`);
}

export function formatDoctorReport(input: {
  connected: boolean;
  studioId?: string | null;
  projectSlug?: string | null;
  projectVersion?: number | null;
  missing: string[];
  backendCheckOk: boolean;
  backendCheckError?: string | null;
}): string {
  const lines = [
    `Connected: ${input.connected ? "yes" : "no"}`,
    formatStatusLine("Studio", input.studioId),
    formatStatusLine("Project", input.projectSlug),
    formatStatusLine("Version", input.projectVersion),
    `Backend check: ${input.backendCheckOk ? "ok" : input.backendCheckError || "failed"}`,
  ];

  if (input.missing.length > 0) {
    lines.push(`Missing: ${input.missing.join(", ")}`);
  }

  return lines.join("\n");
}

export function formatWhoamiReport(input: {
  connected: boolean;
  studioId?: string | null;
  projectSlug?: string | null;
  projectVersion?: number | null;
}): string {
  return [
    `Connected: ${input.connected ? "yes" : "no"}`,
    formatStatusLine("Studio", input.studioId),
    formatStatusLine("Project", input.projectSlug),
    formatStatusLine("Version", input.projectVersion),
  ].join("\n");
}

export function formatProjectInfoReport(input: {
  project: {
    slug: string;
    title: string;
    source: string;
    currentVersion: number;
    requestedVersion: number;
  };
  enabledPluginIds: string[];
}): string {
  return [
    `Project: ${input.project.title}`,
    `Slug: ${input.project.slug}`,
    `Source: ${input.project.source}`,
    `Current version: ${input.project.currentVersion}`,
    `Requested version: ${input.project.requestedVersion}`,
    `Plugins: ${input.enabledPluginIds.length > 0 ? input.enabledPluginIds.join(", ") : "none"}`,
  ].join("\n");
}

export function formatPluginCatalogReport(input: {
  available: Array<{ pluginId: string; name?: string; description?: string }>;
  instances: Array<{ pluginId: string; status: string; instanceId?: string }>;
}): string {
  const enabledInstanceLines =
    input.instances.length > 0
      ? input.instances.map((instance) => `- ${instance.pluginId} (${instance.status})`)
      : ["- none"];
  const catalogLines =
    input.available.length > 0
      ? input.available.map(
          (plugin) => `- ${plugin.pluginId}${plugin.name ? ` - ${plugin.name}` : ""}`,
        )
      : ["- none"];

  return ["Enabled instances:", ...enabledInstanceLines, "", "Catalog:", ...catalogLines].join("\n");
}

export function formatContactPluginReport(input: {
  entitled: boolean;
  entitlementState: string;
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
}): string {
  const configuredRecipients = input.config?.recipientEmails ?? [];
  const formFields = input.config?.formFields ?? [];
  const recipientLines =
    input.recipients.options.length > 0
      ? input.recipients.options.map((recipient) => {
          if (recipient.isVerified) {
            return `- ${recipient.email} [verified]`;
          }
          if (recipient.isPending) {
            const pending = input.recipients.pending.find((row) => row.email === recipient.email);
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

export function formatContactConfigReport(input: {
  projectSlug: string;
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

export function formatContactConfigTemplateReport(input: {
  recipientEmails: string[];
  sourceHosts: string[];
  redirectHostAllowlist: string[];
  formFields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder: string;
    rows?: number;
  }>;
}): string {
  return [
    "Contact config template",
    formatJson(input),
    "",
    "Pipe this into `vivd plugins contact config apply --file -` or save it to a JSON file first.",
  ].join("\n");
}

export function formatContactConfigUpdateReport(projectSlug: string): string {
  return [
    `Contact plugin config updated for ${projectSlug}`,
    "Review it with `vivd plugins contact config show`.",
  ].join("\n");
}

export function formatAnalyticsPluginReport(input: {
  entitled: boolean;
  entitlementState: string;
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
}): string {
  return [
    `Entitled: ${input.entitled ? "yes" : "no"} (${input.entitlementState})`,
    `Enabled: ${input.enabled ? "yes" : "no"}`,
    formatStatusLine("Instance", input.instanceId),
    formatStatusLine("Status", input.status),
    formatStatusLine("Public token", input.publicToken),
    `Script endpoint: ${input.usage.scriptEndpoint}`,
    `Track endpoint: ${input.usage.trackEndpoint}`,
    `Event types: ${input.usage.eventTypes.length > 0 ? input.usage.eventTypes.join(", ") : "none"}`,
    `Respect DNT: ${input.usage.respectDoNotTrack ? "yes" : "no"}`,
    `Capture query string: ${input.usage.captureQueryString ? "yes" : "no"}`,
    `Client tracking: ${input.usage.enableClientTracking ? "enabled" : "disabled"}`,
    "Instructions:",
    ...formatInstructionLines(input.instructions),
  ].join("\n");
}

export function formatContactRecipientVerificationReport(input: {
  email: string;
  status:
    | "already_verified"
    | "added_verified"
    | "verification_sent"
    | "verification_pending";
  cooldownRemainingSeconds: number;
}): string {
  const statusLine =
    input.status === "already_verified"
      ? "already verified"
      : input.status === "added_verified"
        ? "verified and added to the contact config"
        : input.status === "verification_sent"
          ? "verification email sent"
          : "verification already pending";

  const lines = [`Recipient: ${input.email}`, `Status: ${statusLine}`];
  if (input.status === "verification_pending" && input.cooldownRemainingSeconds > 0) {
    lines.push(`Cooldown remaining: ${input.cooldownRemainingSeconds}s`);
  }
  return lines.join("\n");
}

export function formatPublishChecklistReport(input: {
  checklist: {
    projectSlug: string;
    version: number;
    runAt: string;
    snapshotCommitHash?: string | null;
    items: Array<{
      id: string;
      label: string;
      status: string;
      note?: string | null;
    }>;
    summary: {
      passed: number;
      failed: number;
      warnings: number;
      skipped: number;
      fixed?: number;
    };
  } | null;
}): string {
  if (!input.checklist) {
    return [
      "Publish checklist: none",
      "Run `vivd publish checklist run` only if the user explicitly asked for a full checklist run or rerun.",
      "Otherwise, continue checklist work item by item once a saved checklist exists.",
    ].join("\n");
  }

  const itemLines =
    input.checklist.items.length > 0
      ? input.checklist.items.map((item) => {
          const suffix = item.note ? ` | note: ${item.note}` : "";
          return `- ${item.id} | ${item.status} | ${item.label}${suffix}`;
        })
      : ["- none"];

  return [
    `Publish checklist for ${input.checklist.projectSlug} v${input.checklist.version}`,
    `Run at: ${input.checklist.runAt}`,
    formatStatusLine("Snapshot commit", input.checklist.snapshotCommitHash ?? null),
    `Summary: ${input.checklist.summary.passed} passed, ${input.checklist.summary.failed} failed, ${input.checklist.summary.warnings} warnings, ${input.checklist.summary.skipped} skipped${
      input.checklist.summary.fixed != null ? `, ${input.checklist.summary.fixed} fixed` : ""
    }`,
    "Items:",
    ...itemLines,
  ].join("\n");
}

export function formatPublishChecklistRunReport(input: {
  sessionId?: string | null;
  checklist: {
    projectSlug: string;
    version: number;
    runAt: string;
    snapshotCommitHash?: string | null;
    items: Array<{
      id: string;
      label: string;
      status: string;
      note?: string | null;
    }>;
    summary: {
      passed: number;
      failed: number;
      warnings: number;
      skipped: number;
      fixed?: number;
    };
  };
}): string {
  return [
    "Publish checklist run completed.",
    formatStatusLine("Session", input.sessionId),
    "",
    formatPublishChecklistReport({ checklist: input.checklist }),
  ].join("\n");
}

export function formatPublishChecklistUpdateReport(input: {
  item: {
    id: string;
    label: string;
    status: string;
    note?: string | null;
  };
  checklist: {
    summary: {
      passed: number;
      failed: number;
      warnings: number;
      skipped: number;
      fixed?: number;
    };
  };
}): string {
  return [
    `Updated item: ${input.item.id}`,
    `Label: ${input.item.label}`,
    `Status: ${input.item.status}`,
    `Note: ${input.item.note || "n/a"}`,
    `Summary: ${input.checklist.summary.passed} passed, ${input.checklist.summary.failed} failed, ${input.checklist.summary.warnings} warnings, ${input.checklist.summary.skipped} skipped${
      input.checklist.summary.fixed != null ? `, ${input.checklist.summary.fixed} fixed` : ""
    }`,
  ].join("\n");
}
