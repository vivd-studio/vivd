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

function formatPluginCommandHints(pluginId: string, plugin: {
  capabilities?: {
    supportsInfo?: boolean;
    config?: {
      supportsShow?: boolean;
      supportsApply?: boolean;
      supportsTemplate?: boolean;
    } | null;
    actions?: Array<{
      actionId: string;
      arguments?: Array<{
        name: string;
      }>;
    }>;
  };
}): string {
  const commands: string[] = [];
  if (plugin.capabilities?.supportsInfo) {
    commands.push(`info ${pluginId}`);
  }
  if (plugin.capabilities?.config?.supportsShow) {
    commands.push(`config show ${pluginId}`);
  }
  if (plugin.capabilities?.config?.supportsTemplate) {
    commands.push(`config template ${pluginId}`);
  }
  if (plugin.capabilities?.config?.supportsApply) {
    commands.push(`config apply ${pluginId} --file config.json`);
  }
  for (const action of plugin.capabilities?.actions ?? []) {
    const args =
      action.arguments && action.arguments.length > 0
        ? ` ${action.arguments.map((arg) => `<${arg.name}>`).join(" ")}`
        : "";
    commands.push(`action ${pluginId} ${action.actionId}${args}`);
  }

  return commands.length > 0 ? commands.join(" | ") : "none";
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

export function formatPreviewScreenshotReport(input: {
  path: string;
  capturedUrl: string;
  savedPath: string;
  format: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}): string {
  return [
    `Preview screenshot saved: ${input.savedPath}`,
    `Preview path: ${input.path}`,
    `Captured URL: ${input.capturedUrl}`,
    `Viewport: ${input.width}x${input.height}`,
    `Scroll: ${input.scrollX}, ${input.scrollY}`,
    `Format: ${input.format}`,
  ].join("\n");
}

function formatPreviewLogLocation(location: {
  url?: string;
  line?: number;
  column?: number;
} | null | undefined): string {
  if (!location) return "";
  const parts: string[] = [];
  if (location.url) {
    parts.push(location.url);
  }
  if (typeof location.line === "number") {
    parts.push(
      typeof location.column === "number"
        ? `${location.line}:${location.column}`
        : String(location.line),
    );
  }
  return parts.length > 0 ? ` | ${parts.join(" ")}` : "";
}

function compactPreviewLogText(text: string): string {
  return text.replace(/\s+/g, " ").trim() || "(empty message)";
}

export function formatPreviewLogsReport(input: {
  path: string;
  capturedUrl: string;
  waitMs: number;
  limit: number;
  level: "debug" | "log" | "info" | "warn" | "error";
  contains?: string;
  entries: Array<{
    type: string;
    text: string;
    textTruncated: boolean;
    location?: {
      url?: string;
      line?: number;
      column?: number;
    };
  }>;
  summary: {
    observed: number;
    matched: number;
    returned: number;
    dropped: number;
    truncatedMessages: number;
  };
}): string {
  const filters = [
    `level>=${input.level}`,
    `limit=${input.limit}`,
    `wait=${input.waitMs}ms`,
  ];
  if (input.contains) {
    filters.push(`contains="${input.contains}"`);
  }

  const lines = [
    "Preview logs captured for debugging.",
    `Preview path: ${input.path}`,
    `Captured URL: ${input.capturedUrl}`,
    `Filters: ${filters.join(" | ")}`,
    `Summary: ${input.summary.observed} observed, ${input.summary.matched} matched, ${input.summary.returned} returned, ${input.summary.dropped} dropped${input.summary.truncatedMessages > 0 ? `, ${input.summary.truncatedMessages} truncated` : ""}`,
  ];

  if (input.entries.length === 0) {
    lines.push("Entries: none");
    return lines.join("\n");
  }

  lines.push("Entries:");
  lines.push(
    ...input.entries.map((entry) => {
      const suffix = entry.textTruncated ? " | truncated" : "";
      return `- [${entry.type}] ${compactPreviewLogText(entry.text)}${formatPreviewLogLocation(entry.location)}${suffix}`;
    }),
  );
  return lines.join("\n");
}

export function formatPreviewStatusReport(input: {
  provider: "local" | "fly" | "docker";
  runtime: {
    running: boolean;
    health: "ok" | "starting" | "unreachable" | "stopped";
    browserUrl: string | null;
    error?: string;
  };
  preview: {
    mode: "static" | "devserver" | "unknown";
    status: "ready" | "starting" | "installing" | "error" | "unavailable";
    error?: string;
  };
  devServer: {
    applicable: boolean;
    running: boolean;
    status:
      | "ready"
      | "starting"
      | "installing"
      | "error"
      | "not_applicable"
      | "unknown";
  };
}): string {
  const lines = [
    "Preview status for debugging.",
    `Provider: ${input.provider}`,
    `Studio runtime: ${input.runtime.running ? "running" : "stopped"}`,
    `Runtime health: ${input.runtime.health}`,
    `Preview mode: ${input.preview.mode}`,
    `Preview status: ${input.preview.status}`,
    `Dev server: ${
      input.devServer.applicable
        ? input.devServer.running
          ? "running"
          : `not running (${input.devServer.status})`
        : "not applicable"
    }`,
  ];

  if (input.runtime.browserUrl) {
    lines.push(`Browser URL: ${input.runtime.browserUrl}`);
  }
  if (input.preview.error) {
    lines.push(`Preview error: ${input.preview.error}`);
  } else if (input.runtime.error) {
    lines.push(`Runtime error: ${input.runtime.error}`);
  }

  return lines.join("\n");
}

export function formatCmsStatusReport(input: {
  initialized: boolean;
  valid: boolean;
  contentRoot: string;
  modelCount: number;
  entryCount: number;
  assetCount: number;
  mediaFileCount: number;
  models: Array<{
    key: string;
    label: string;
    entries: Array<unknown>;
  }>;
  errors: string[];
}): string {
  const lines = [
    `CMS root: ${input.contentRoot}`,
    `Initialized: ${input.initialized ? "yes" : "no"}`,
    `Validation: ${input.valid ? "ok" : "failed"}`,
    `Models: ${input.modelCount}`,
    `Entries: ${input.entryCount}`,
    `Asset refs: ${input.assetCount}`,
    `Media files: ${input.mediaFileCount}`,
  ];

  if (input.models.length > 0) {
    lines.push("Models:");
    lines.push(
      ...input.models.map(
        (model) => `- ${model.key} (${model.label}) - ${model.entries.length} entr${model.entries.length === 1 ? "y" : "ies"}`,
      ),
    );
  }

  if (input.errors.length > 0) {
    lines.push("Errors:");
    lines.push(...input.errors.map((error) => `- ${error}`));
  } else {
    lines.push("Errors: none");
  }

  return lines.join("\n");
}

export function formatCmsValidateReport(input: {
  valid: boolean;
  modelCount: number;
  entryCount: number;
  assetCount: number;
  errors: string[];
}): string {
  if (input.valid) {
    return [
      "CMS validate: ok",
      `Models: ${input.modelCount}`,
      `Entries: ${input.entryCount}`,
      `Asset refs: ${input.assetCount}`,
    ].join("\n");
  }

  return ["CMS validate: failed", ...input.errors.map((error) => `- ${error}`)].join("\n");
}

export function formatCmsScaffoldReport(input: {
  title: string;
  created: string[];
  skipped: string[];
}): string {
  return [
    input.title,
    "Created:",
    ...(input.created.length > 0 ? input.created.map((value) => `- ${value}`) : ["- none"]),
    "Skipped:",
    ...(input.skipped.length > 0 ? input.skipped.map((value) => `- ${value}`) : ["- none"]),
  ].join("\n");
}

export function formatCmsBuildArtifactsReport(input: {
  outputDir: string;
  manifestPath: string;
  modelCount: number;
  entryCount: number;
  assetCount: number;
  mediaFileCount: number;
}): string {
  return [
    "CMS artifacts built.",
    `Output: ${input.outputDir}`,
    `Manifest: ${input.manifestPath}`,
    `Models: ${input.modelCount}`,
    `Entries: ${input.entryCount}`,
    `Asset refs: ${input.assetCount}`,
    `Media files copied: ${input.mediaFileCount}`,
  ].join("\n");
}

export function formatPluginCatalogReport(input: {
  available: Array<{
    pluginId: string;
    name?: string;
    description?: string;
    capabilities?: {
      supportsInfo?: boolean;
      config?: {
        supportsShow?: boolean;
        supportsApply?: boolean;
        supportsTemplate?: boolean;
      } | null;
      actions?: Array<{
        actionId: string;
        arguments?: Array<{
          name: string;
        }>;
      }>;
    };
  }>;
  instances: Array<{ pluginId: string; status: string; instanceId?: string }>;
}): string {
  const enabledInstanceLines =
    input.instances.length > 0
      ? input.instances.map((instance) => `- ${instance.pluginId} (${instance.status})`)
      : ["- none"];
  const catalogLines =
    input.available.length > 0
      ? input.available.flatMap((plugin) => [
          `- ${plugin.pluginId}${plugin.name ? ` - ${plugin.name}` : ""}`,
          `  Commands: ${formatPluginCommandHints(plugin.pluginId, plugin)}`,
        ])
      : ["- none"];

  return ["Enabled instances:", ...enabledInstanceLines, "", "Catalog:", ...catalogLines].join("\n");
}

export function formatGenericPluginInfoReport(input: {
  pluginId: string;
  catalog: {
    name: string;
    description: string;
    capabilities: {
      supportsInfo: boolean;
      config: {
        supportsShow: boolean;
        supportsApply: boolean;
        supportsTemplate: boolean;
      } | null;
      actions: Array<{
        actionId: string;
        title: string;
        arguments: Array<{
          name: string;
        }>;
      }>;
    };
  };
  entitled: boolean;
  entitlementState: string;
  enabled: boolean;
  instanceId: string | null;
  status: string | null;
  publicToken: string | null;
  usage: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  instructions: string[];
}): string {
  const actionLines =
    input.catalog.capabilities.actions.length > 0
      ? input.catalog.capabilities.actions.map((action) => {
          const args =
            action.arguments.length > 0
              ? ` ${action.arguments.map((arg) => `<${arg.name}>`).join(" ")}`
              : "";
          return `- ${action.actionId}${args} - ${action.title}`;
        })
      : ["- none"];

  return [
    `Plugin: ${input.catalog.name}`,
    `Plugin ID: ${input.pluginId}`,
    `Description: ${input.catalog.description}`,
    `Entitled: ${input.entitled ? "yes" : "no"} (${input.entitlementState})`,
    `Enabled: ${input.enabled ? "yes" : "no"}`,
    formatStatusLine("Instance", input.instanceId),
    formatStatusLine("Status", input.status),
    formatStatusLine("Public token", input.publicToken),
    `Config support: ${
      input.catalog.capabilities.config
        ? [
            input.catalog.capabilities.config.supportsShow ? "show" : null,
            input.catalog.capabilities.config.supportsTemplate ? "template" : null,
            input.catalog.capabilities.config.supportsApply ? "apply" : null,
          ]
            .filter(Boolean)
            .join(", ")
        : "none"
    }`,
    "Actions:",
    ...actionLines,
    "Usage:",
    formatJson(input.usage ?? {}),
    "Current config:",
    formatJson(input.config ?? {}),
    "Instructions:",
    ...formatInstructionLines(input.instructions),
  ].join("\n");
}

export function formatGenericPluginConfigReport(input: {
  pluginId: string;
  pluginName: string;
  projectSlug: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
  entitled: boolean;
}): string {
  if (!input.config) {
    return [
      `${input.pluginName} config for ${input.projectSlug}`,
      "No saved plugin config exists for this project yet.",
      `Plugin enabled: ${input.enabled ? "yes" : "no"}`,
      `Plugin entitled: ${input.entitled ? "yes" : "no"}`,
      `Use \`vivd plugins config template ${input.pluginId}\` to print a valid config payload.`,
    ].join("\n");
  }

  return [
    `${input.pluginName} config for ${input.projectSlug}`,
    formatJson(input.config),
    "",
    `Apply updates with \`vivd plugins config apply ${input.pluginId} --file -\` or a JSON file path.`,
  ].join("\n");
}

export function formatGenericPluginConfigTemplateReport(input: {
  pluginId: string;
  pluginName: string;
  defaultConfig: Record<string, unknown>;
}): string {
  return [
    `${input.pluginName} config template`,
    formatJson(input.defaultConfig),
    "",
    `Pipe this into \`vivd plugins config apply ${input.pluginId} --file -\` or save it to a JSON file first.`,
  ].join("\n");
}

export function formatGenericPluginConfigUpdateReport(input: {
  pluginId: string;
  pluginName: string;
  projectSlug: string;
}): string {
  return [
    `${input.pluginName} config updated for ${input.projectSlug}`,
    `Review it with \`vivd plugins config show ${input.pluginId}\`.`,
  ].join("\n");
}

export function formatGenericPluginActionReport(input: {
  pluginId: string;
  actionId: string;
  summary: string;
  result: unknown;
}): string {
  return [
    input.summary,
    `Plugin: ${input.pluginId}`,
    `Action: ${input.actionId}`,
    formatJson(input.result),
  ].join("\n");
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
