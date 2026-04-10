import fs from "node:fs/promises";
import path from "node:path";
import { validateConnectedStudioBackendClientConfig } from "@vivd/shared/studio";
import { parseCliArgs, resolveHelpTopic, isHelpRequested, type CliFlags } from "./args.js";
import { resolveCliRuntime } from "./backend.js";
import {
  buildCmsArtifacts,
  getCmsStatus,
  scaffoldCmsEntry,
  scaffoldCmsModel,
  scaffoldCmsWorkspace,
  validateCmsWorkspace,
} from "./cms.js";
import {
  formatCmsBuildArtifactsReport,
  formatCmsScaffoldReport,
  formatCmsStatusReport,
  formatCmsValidateReport,
  formatDoctorReport,
  formatGenericPluginActionReport,
  formatGenericPluginConfigReport,
  formatGenericPluginConfigTemplateReport,
  formatGenericPluginConfigUpdateReport,
  formatGenericPluginInfoReport,
  formatPluginCatalogReport,
  formatPreviewLogsReport,
  formatPreviewScreenshotReport,
  formatPreviewStatusReport,
  formatProjectInfoReport,
  formatPublishChecklistReport,
  formatPublishChecklistRunReport,
  formatPublishChecklistUpdateReport,
  formatWhoamiReport,
} from "./format.js";
import {
  getCliPluginModule,
  getCliPluginHelpText,
  listCliPluginHelpSummaryLines,
  renderCliPluginAction,
  renderCliPluginConfig,
  renderCliPluginConfigTemplate,
  renderCliPluginConfigUpdate,
  renderCliPluginInfo,
  resolveCliPluginAlias,
} from "./plugins/registry.js";
import type { PluginCliInfoContractPayload } from "@vivd/shared/types";

type CommandResult = {
  data: unknown;
  human: string;
  exitCode?: number;
};

type ProjectInfoResponse = {
  project: {
    slug: string;
    title: string;
    source: "url" | "scratch";
    currentVersion: number;
    requestedVersion: number;
  };
  enabledPluginIds: string[];
};

type ChecklistStatus = "pass" | "fail" | "warning" | "skip" | "fixed";

type PublishChecklistItem = {
  id: string;
  label: string;
  status: ChecklistStatus;
  note?: string | null;
};

type PublishChecklist = {
  projectSlug: string;
  version: number;
  runAt: string;
  snapshotCommitHash?: string | null;
  items: PublishChecklistItem[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    fixed?: number;
  };
};

type PublishChecklistQueryResponse = {
  checklist: PublishChecklist | null;
};

type PublishChecklistUpdateResponse = {
  checklist: PublishChecklist;
  item: PublishChecklistItem;
};

type PublishChecklistRunResponse = {
  success: boolean;
  checklist: PublishChecklist;
  sessionId: string;
};

type PreviewScreenshotResponse = {
  path: string;
  capturedUrl: string;
  filename: string;
  mimeType: string;
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  imageBase64: string;
};

type PreviewLogLevel = "debug" | "log" | "info" | "warn" | "error";

type PreviewLogsResponse = {
  path: string;
  capturedUrl: string;
  waitMs: number;
  limit: number;
  level: PreviewLogLevel;
  contains?: string;
  entries: Array<{
    type: "debug" | "log" | "info" | "warn" | "error" | "pageerror";
    text: string;
    timestamp: string;
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
};

type PreviewStatusResponse = {
  provider: "local" | "fly" | "docker";
  runtime: {
    running: boolean;
    health: "ok" | "starting" | "unreachable" | "stopped";
    browserUrl: string | null;
    runtimeUrl: string | null;
    compatibilityUrl: string | null;
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
};

type PluginCatalogResponse = {
  project: { organizationId: string; slug: string };
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
        title?: string;
        arguments?: Array<{
          name: string;
          type?: string;
          required?: boolean;
          description?: string;
        }>;
      }>;
    };
  }>;
  instances: Array<{ pluginId: string; status: string; instanceId: string }>;
};

type PluginActionResponse = {
  pluginId: string;
  actionId: string;
  summary: string;
  result: unknown;
};

const GENERAL_HELP: Record<string, string> = {
  root: "",
  plugins: [
    "vivd plugins catalog",
    "vivd plugins info <pluginId>",
    "vivd plugins config show <pluginId>",
    "vivd plugins config template <pluginId>",
    "vivd plugins config apply <pluginId> --file config.json",
    "vivd plugins action <pluginId> <actionId> [args...]",
    "Legacy aliases still work for current first-party plugins:",
    "vivd plugins contact info",
    "vivd plugins contact config show",
    "vivd plugins contact config template",
    "vivd plugins contact config apply --file config.json",
    "vivd plugins contact recipients verify <email>",
    "vivd plugins contact recipients mark-verified <email>",
    "vivd plugins contact recipients resend <email>",
  ].join("\n"),
  cms: [
    "vivd cms status",
    "vivd cms validate",
    "vivd cms scaffold init",
    "vivd cms scaffold model <key>",
    "vivd cms scaffold entry <model-key> <entry-key>",
    "vivd cms build-artifacts",
    "Vivd CMS is local and file-based under src/content/ for Astro-backed projects.",
    "Use collection-backed CMS content selectively for structured, repeatable, user-managed domains like products, blogs, directories, downloads, or case studies.",
  ].join("\n"),
  publish: [
    "vivd publish checklist run",
    "vivd publish checklist show",
    "vivd publish checklist update <item-id> --status <status> [--note ...]",
    "Use `run` only when the user explicitly asks for a full checklist run or rerun; it is slower and more expensive than normal checks.",
    "Use `show` and `update` to inspect or continue checklist items one by one without starting a new full run.",
    "Allowed statuses: pass, fail, warning, skip, fixed",
    "Use --slug and --version (or VIVD_PROJECT_SLUG / VIVD_PROJECT_VERSION).",
  ].join("\n"),
};

type HelpEntry = {
  command: string;
  description: string;
};

function jsonResult(data: unknown, human: string, exitCode?: number): CommandResult {
  return { data, human, exitCode };
}

function ensureConnectedRuntime(
  flags: Pick<CliFlags, "slug" | "version">,
): ReturnType<typeof resolveCliRuntime> {
  return resolveCliRuntime(process.env, flags);
}

function requireProjectSlug(runtime: ReturnType<typeof resolveCliRuntime>): string {
  if (!runtime?.projectSlug) {
    throw new Error("This command requires a project slug. Set VIVD_PROJECT_SLUG or pass --slug.");
  }
  return runtime.projectSlug;
}

function requireProjectVersion(runtime: ReturnType<typeof resolveCliRuntime>): number {
  if (!runtime?.projectVersion) {
    throw new Error(
      "This command requires a project version. Set VIVD_PROJECT_VERSION or pass --version.",
    );
  }
  return runtime.projectVersion;
}

function parseProjectVersion(rawValue: string | undefined): number | null {
  const parsed = Number.parseInt(rawValue || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveProjectContext(
  flags: Pick<CliFlags, "slug" | "version">,
): {
  projectSlug: string | null;
  projectVersion: number | null;
} {
  const runtime = ensureConnectedRuntime(flags);
  const projectSlug =
    runtime?.projectSlug ?? ((flags.slug ?? process.env.VIVD_PROJECT_SLUG ?? "").trim() || null);
  const projectVersion =
    runtime?.projectVersion ?? flags.version ?? parseProjectVersion(process.env.VIVD_PROJECT_VERSION);

  return {
    projectSlug,
    projectVersion,
  };
}

function requireResolvedProjectSlug(flags: Pick<CliFlags, "slug" | "version">): string {
  const slug = resolveProjectContext(flags).projectSlug;
  if (!slug) {
    throw new Error("This command requires a project slug. Set VIVD_PROJECT_SLUG or pass --slug.");
  }
  return slug;
}

function requireResolvedProjectVersion(flags: Pick<CliFlags, "slug" | "version">): number {
  const version = resolveProjectContext(flags).projectVersion;
  if (!version) {
    throw new Error(
      "This command requires a project version. Set VIVD_PROJECT_VERSION or pass --version.",
    );
  }
  return version;
}

function resolveInputPath(inputPath: string, cwd: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.join(cwd, inputPath);
}

async function readJsonFile(value: string): Promise<unknown> {
  if (value === "-") {
    return new Promise((resolve, reject) => {
      let raw = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        raw += chunk;
      });
      process.stdin.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
      process.stdin.on("error", reject);
    });
  }

  return fs.readFile(value, "utf8").then((text) => JSON.parse(text));
}

function unwrapTrpcBody(body: any): any {
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function isPreviewScreenshotCliEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanEnv(env.VIVD_CLI_PREVIEW_SCREENSHOT_ENABLED, false);
}

function formatHelpEntries(entries: HelpEntry[]): string[] {
  const width = entries.reduce((max, entry) => Math.max(max, entry.command.length), 0);
  return entries.map(
    (entry) => `  ${entry.command.padEnd(width)}  ${entry.description}`,
  );
}

function formatHelpSection(title: string, entries: HelpEntry[]): string[] {
  return [title, ...formatHelpEntries(entries)];
}

function formatHelpListSection(title: string, lines: string[]): string[] {
  return [title, ...lines.map((line) => `  ${line}`)];
}

function getRootHelpText(env: NodeJS.ProcessEnv = process.env): string {
  const previewEntries: HelpEntry[] = [
    {
      command: "vivd preview status",
      description: "Show runtime health, preview mode, browser URL, and dev server state",
    },
    {
      command: "vivd preview logs [path]",
      description: "Capture browser console output for a preview path such as / or /pricing",
    },
    {
      command: "vivd preview help",
      description: "Show preview-specific flags, filters, and screenshot guidance",
    },
  ];

  if (isPreviewScreenshotCliEnabled(env)) {
    previewEntries.splice(2, 0, {
      command: "vivd preview screenshot [path]",
      description: "Capture a preview screenshot (experimental; saved under .vivd/dropped-images/ by default)",
    });
  }

  const pluginShortcutLines = Array.from(new Set(listCliPluginHelpSummaryLines()));

  const lines = [
    "Work with the connected Vivd project, preview runtime, plugins, and local CMS workspace.",
    "",
    "USAGE",
    "  vivd <command> <subcommand> [flags]",
    "",
    ...formatHelpSection("CONNECTION & CONTEXT", [
      {
        command: "vivd doctor",
        description: "Check backend connectivity, auth env, and the current Studio/project context",
      },
      {
        command: "vivd whoami",
        description: "Print the connected Studio, project slug, and project version",
      },
      {
        command: "vivd project info",
        description: "Show project metadata and currently enabled plugins",
      },
    ]),
    "",
    ...formatHelpSection("PREVIEW & DEBUGGING", previewEntries),
    "",
    ...formatHelpSection("PLUGINS", [
      {
        command: "vivd plugins catalog",
        description: "List available and enabled plugins for the current project",
      },
      {
        command: "vivd plugins info <pluginId>",
        description: "Show plugin state, usage hints, and supported capabilities",
      },
      {
        command: "vivd plugins config show <pluginId>",
        description: "Print the current plugin config",
      },
      {
        command: "vivd plugins config template <pluginId>",
        description: "Print a starter JSON config payload",
      },
      {
        command: "vivd plugins config apply <pluginId> --file config.json",
        description: "Update a plugin config from JSON on disk or stdin",
      },
      {
        command: "vivd plugins action <pluginId> <actionId> [args...]",
        description: "Run a plugin action such as recipient verification",
      },
      {
        command: "vivd plugins help",
        description: "Show the generic plugin workflow plus available plugin aliases",
      },
    ]),
  ];

  if (pluginShortcutLines.length > 0) {
    lines.push(
      "",
      ...formatHelpListSection("PLUGIN SHORTCUTS", [
        "Prefer the generic `vivd plugins ...` grammar when possible; current first-party aliases include:",
        ...pluginShortcutLines,
      ]),
    );
  }

  lines.push(
    "",
    ...formatHelpSection("LOCAL CMS", [
      {
        command: "vivd cms status",
        description: "Inspect the local src/content/ workspace state",
      },
      {
        command: "vivd cms validate",
        description: "Validate local CMS files without a connected runtime",
      },
      {
        command: "vivd cms scaffold init",
        description: "Create the baseline local CMS structure",
      },
      {
        command: "vivd cms scaffold model <key>",
        description: "Create a starter schema/model file",
      },
      {
        command: "vivd cms scaffold entry <model-key> <entry-key>",
        description: "Create a starter content entry file",
      },
      {
        command: "vivd cms build-artifacts",
        description: "Regenerate derived artifacts under .vivd/content",
      },
      {
        command: "vivd cms help",
        description: "Show CMS-specific guidance and constraints",
      },
    ]),
    "",
    ...formatHelpSection("PUBLISH CHECKLIST", [
      {
        command: "vivd publish checklist show",
        description: "Inspect the current checklist state for the targeted project version",
      },
      {
        command: "vivd publish checklist update <item-id> --status <status>",
        description: "Update one checklist item status or note",
      },
      {
        command: "vivd publish checklist run",
        description: "Start a full checklist pass; use only when the user explicitly asks",
      },
      {
        command: "vivd publish help",
        description: "Show checklist workflow details and allowed statuses",
      },
    ]),
    "",
    ...formatHelpSection("GLOBAL FLAGS", [
      {
        command: "--help",
        description: "Show help for the current command",
      },
      {
        command: "--json",
        description: "Print machine-readable JSON instead of the human summary",
      },
      {
        command: "--slug <project-slug>",
        description: "Override VIVD_PROJECT_SLUG for project-scoped commands",
      },
      {
        command: "--version <project-version>",
        description: "Override VIVD_PROJECT_VERSION for project-scoped commands",
      },
    ]),
    "",
    ...formatHelpListSection("EXAMPLES", [
      "$ vivd doctor",
      "$ vivd project info",
      "$ vivd preview status",
      "$ vivd preview logs /pricing --level warn --contains hydrate",
      "$ vivd plugins catalog",
      "$ vivd plugins info analytics",
      "$ vivd plugins action contact_form verify_recipient owner@example.com",
      "$ vivd cms validate",
      "$ vivd publish checklist show",
    ]),
    "",
    ...formatHelpListSection("LEARN MORE", [
      "Connected commands need MAIN_BACKEND_URL, STUDIO_ID, and STUDIO_ACCESS_TOKEN.",
      "Project-scoped commands use VIVD_PROJECT_SLUG / VIVD_PROJECT_VERSION or --slug / --version.",
      "Use `vivd <command> help` for command-specific flags, aliases, and examples.",
    ]),
  );

  return lines.join("\n");
}

function isPreviewScreenshotFormat(value: string | undefined): value is "png" | "jpeg" | "webp" {
  return value === "png" || value === "jpeg" || value === "webp";
}

function isPreviewLogLevel(value: string | undefined): value is PreviewLogLevel {
  return (
    value === "debug" ||
    value === "log" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

function getPreviewHelpText(env: NodeJS.ProcessEnv = process.env): string {
  const lines = [
    "vivd preview status",
    "Show preview/runtime debugging status, including whether the dev server is running.",
    "vivd preview logs [path]",
    "Capture browser console output from the previewed site for debugging.",
    "Use preview-relative paths like /, /pricing, or /contact?tab=form.",
    "Optional flags: --wait-ms --limit --level --contains",
    "Default scope: preview page only; this does not include Studio shell or backend logs.",
  ];

  if (isPreviewScreenshotCliEnabled(env)) {
    lines.push(
      "",
      "Experimental screenshot command:",
      "vivd preview screenshot [path]",
      "Optional flags: --width --height --scroll-x --scroll-y --wait-ms --format --output",
      "Screenshots are saved under .vivd/dropped-images/ by default unless --output is passed.",
      "Run this from the project workspace so the default output path lands in the current project.",
    );
  }

  return lines.join("\n");
}

async function ensureUniqueFilePath(filePath: string): Promise<string> {
  try {
    await fs.access(filePath);
  } catch {
    return filePath;
  }

  const parsed = path.parse(filePath);
  let counter = 2;
  let candidate = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);

  while (true) {
    try {
      await fs.access(candidate);
      counter += 1;
      candidate = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
    } catch {
      return candidate;
    }
  }
}

function getLocalStudioTrpcBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = parseProjectVersion(env.PORT) ?? 3100;
  return `http://127.0.0.1:${port}/vivd-studio/api/trpc`;
}

async function callLocalStudioMutation<T>(
  procedure: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const studioAccessToken = env.STUDIO_ACCESS_TOKEN?.trim();
  if (studioAccessToken) {
    headers["x-vivd-studio-token"] = studioAccessToken;
  }

  const response = await fetch(`${getLocalStudioTrpcBaseUrl(env)}/${procedure}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`${procedure} failed (${response.status}): ${errorText}`);
  }

  const body = await response.json().catch(() => null);
  return unwrapTrpcBody(body) as T;
}

function isChecklistStatus(value: string | undefined): value is ChecklistStatus {
  return (
    value === "pass" ||
    value === "fail" ||
    value === "warning" ||
    value === "skip" ||
    value === "fixed"
  );
}

async function withRuntime<T>(
  flags: Pick<CliFlags, "slug" | "version">,
  fn: (runtime: NonNullable<ReturnType<typeof resolveCliRuntime>>) => Promise<T>,
): Promise<T> {
  const runtime = ensureConnectedRuntime(flags);
  if (!runtime) {
    throw new Error(
      "Vivd CLI is not connected. Set MAIN_BACKEND_URL, STUDIO_ID, and STUDIO_ACCESS_TOKEN.",
    );
  }
  return fn(runtime);
}

function helpTextFor(topic: string[]): string {
  const normalized = topic.join(" ").trim();
  if (!normalized || normalized === "root") {
    return getRootHelpText();
  }
  if (normalized.startsWith("preview")) {
    return getPreviewHelpText();
  }
  const pluginHelp = getCliPluginHelpText(topic);
  if (pluginHelp) {
    return pluginHelp;
  }
  if (normalized.startsWith("plugins")) {
    const summaryLines = listCliPluginHelpSummaryLines();
    if (summaryLines.length === 0) {
      return GENERAL_HELP.plugins;
    }
    return [GENERAL_HELP.plugins, ...summaryLines].join("\n");
  }
  if (normalized.startsWith("cms")) {
    return GENERAL_HELP.cms;
  }
  if (normalized.startsWith("publish")) {
    return GENERAL_HELP.publish;
  }
  return getRootHelpText();
}

async function runCmsStatus(cwd: string): Promise<CommandResult> {
  const report = await getCmsStatus(cwd);
  return jsonResult(
    report,
    formatCmsStatusReport({
      initialized: report.initialized,
      valid: report.valid,
      contentRoot: report.paths.contentRoot,
      modelCount: report.modelCount,
      entryCount: report.entryCount,
      assetCount: report.assetCount,
      mediaFileCount: report.mediaFileCount,
      models: report.models,
      errors: report.errors,
    }),
    report.valid ? 0 : 1,
  );
}

async function runCmsValidate(cwd: string): Promise<CommandResult> {
  const report = await validateCmsWorkspace(cwd);
  return jsonResult(
    report,
    formatCmsValidateReport({
      valid: report.valid,
      modelCount: report.modelCount,
      entryCount: report.entryCount,
      assetCount: report.assetCount,
      errors: report.errors,
    }),
    report.valid ? 0 : 1,
  );
}

async function runCmsScaffoldInit(cwd: string): Promise<CommandResult> {
  const result = await scaffoldCmsWorkspace(cwd);
  return jsonResult(
    result,
    formatCmsScaffoldReport({
      title: "CMS scaffold initialized.",
      created: result.created,
      skipped: result.skipped,
    }),
  );
}

async function runCmsScaffoldModel(modelKey: string, cwd: string): Promise<CommandResult> {
  const result = await scaffoldCmsModel(cwd, modelKey);
  return jsonResult(
    result,
    formatCmsScaffoldReport({
      title: `CMS model scaffolded: ${modelKey}`,
      created: result.created,
      skipped: result.skipped,
    }),
  );
}

async function runCmsScaffoldEntry(
  modelKey: string,
  entryKey: string,
  cwd: string,
): Promise<CommandResult> {
  const result = await scaffoldCmsEntry(cwd, modelKey, entryKey);
  return jsonResult(
    result,
    formatCmsScaffoldReport({
      title: `CMS entry scaffolded: ${modelKey}/${entryKey}`,
      created: result.created,
      skipped: result.skipped,
    }),
  );
}

async function runCmsBuildArtifacts(cwd: string): Promise<CommandResult> {
  const result = await buildCmsArtifacts(cwd);
  return jsonResult(
    result,
    formatCmsBuildArtifactsReport({
      outputDir: result.outputDir,
      manifestPath: result.manifestPath,
      modelCount: result.modelCount,
      entryCount: result.entryCount,
      assetCount: result.assetCount,
      mediaFileCount: result.mediaFileCount,
    }),
  );
}

type CliPluginRenderMode = "auto" | "generic" | "plugin";

function shouldUseCliPluginRenderer(
  pluginId: string,
  mode: CliPluginRenderMode,
  key: "info" | "config" | "configTemplate" | "configUpdate" | "action",
): boolean {
  if (mode === "plugin") return true;
  if (mode === "generic") return false;
  return getCliPluginModule(pluginId)?.genericRendererModes?.[key] === true;
}

async function runDoctor(flags: CliFlags): Promise<CommandResult> {
  const runtime = ensureConnectedRuntime(flags);
  const validation = validateConnectedStudioBackendClientConfig(runtime?.config);
  const connected = Boolean(runtime);
  let backendCheckOk = false;
  let backendCheckError: string | null = null;

  if (runtime) {
    try {
      await runtime.client.query("studioApi.getStatus", {
        studioId: runtime.config.studioId,
      });
      backendCheckOk = true;
    } catch (error) {
      backendCheckError = error instanceof Error ? error.message : String(error);
    }
  }

  return jsonResult(
    {
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
      validation,
      backendCheck: {
        ok: backendCheckOk,
        error: backendCheckError,
      },
    },
    formatDoctorReport({
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
      missing: validation.missing,
      backendCheckOk,
      backendCheckError,
    }),
    validation.ok && backendCheckOk ? 0 : 1,
  );
}

async function runWhoami(flags: CliFlags): Promise<CommandResult> {
  const runtime = ensureConnectedRuntime(flags);
  const connected = Boolean(runtime);

  return jsonResult(
    {
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
    },
    formatWhoamiReport({
      connected,
      studioId: runtime?.config.studioId ?? null,
      projectSlug: runtime?.projectSlug ?? null,
      projectVersion: runtime?.projectVersion ?? null,
    }),
  );
}

async function runProjectInfo(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const info = (await runtime.client.query("studioApi.getProjectInfo", {
      studioId: runtime.config.studioId,
      slug,
      version: runtime.projectVersion ?? undefined,
    })) as ProjectInfoResponse;

    return jsonResult(info, formatProjectInfoReport(info));
  });
}

async function runPreviewScreenshot(
  pathArg: string | undefined,
  flags: CliFlags,
  cwd: string,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const version = requireProjectVersion(runtime);
    const format = (flags.format?.trim().toLowerCase() || "png") as
      | "png"
      | "jpeg"
      | "webp";
    if (!isPreviewScreenshotFormat(format)) {
      throw new Error("preview screenshot requires --format <png|jpeg|webp>");
    }

    const screenshot = (await runtime.client.mutation(
      "studioApi.capturePreviewScreenshot",
      {
        studioId: runtime.config.studioId,
        slug,
        version,
        path: pathArg || "/",
        width: flags.width,
        height: flags.height,
        scrollX: flags.scrollX,
        scrollY: flags.scrollY,
        waitMs: flags.waitMs,
        format,
      },
    )) as PreviewScreenshotResponse;

    const requestedOutput = flags.output?.trim();
    const defaultOutput = path.join(cwd, ".vivd", "dropped-images", screenshot.filename);
    const resolvedOutput = requestedOutput
      ? resolveInputPath(requestedOutput, cwd)
      : defaultOutput;
    await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
    const savedPath = await ensureUniqueFilePath(resolvedOutput);
    await fs.writeFile(savedPath, Buffer.from(screenshot.imageBase64, "base64"));

    const printable = {
      path: screenshot.path,
      capturedUrl: screenshot.capturedUrl,
      filename: screenshot.filename,
      mimeType: screenshot.mimeType,
      format: screenshot.format,
      width: screenshot.width,
      height: screenshot.height,
      scrollX: screenshot.scrollX,
      scrollY: screenshot.scrollY,
      savedPath,
    };

    return jsonResult(printable, formatPreviewScreenshotReport(printable));
  });
}

async function runPreviewLogs(
  pathArg: string | undefined,
  flags: CliFlags,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const version = requireProjectVersion(runtime);
    const level = flags.level?.trim().toLowerCase();
    if (level && !isPreviewLogLevel(level)) {
      throw new Error("preview logs requires --level <debug|log|info|warn|error>");
    }

    const result = (await runtime.client.mutation("studioApi.capturePreviewLogs", {
      studioId: runtime.config.studioId,
      slug,
      version,
      path: pathArg || "/",
      waitMs: flags.waitMs,
      limit: flags.limit,
      level,
      contains: flags.contains?.trim() || undefined,
    })) as PreviewLogsResponse;

    return jsonResult(result, formatPreviewLogsReport(result));
  });
}

async function runPreviewStatus(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const version = requireProjectVersion(runtime);

    const result = (await runtime.client.query("studioApi.getPreviewStatus", {
      studioId: runtime.config.studioId,
      slug,
      version,
    })) as PreviewStatusResponse;

    return jsonResult(result, formatPreviewStatusReport(result));
  });
}

async function runPluginsCatalog(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const catalog = (await runtime.client.query("studioApi.getProjectPluginsCatalog", {
      studioId: runtime.config.studioId,
      slug,
      version: runtime.projectVersion ?? undefined,
    })) as PluginCatalogResponse;
    return jsonResult(catalog, formatPluginCatalogReport(catalog));
  });
}

async function getPluginInfoContract(
  runtime: NonNullable<ReturnType<typeof resolveCliRuntime>>,
  pluginId: string,
): Promise<PluginCliInfoContractPayload> {
  const slug = requireProjectSlug(runtime);
  return (await runtime.client.query("studioApi.getProjectPluginInfo", {
    studioId: runtime.config.studioId,
    slug,
    pluginId,
  })) as PluginCliInfoContractPayload;
}

async function runPluginsInfoGeneric(
  pluginId: string,
  flags: CliFlags,
  renderMode: CliPluginRenderMode = "auto",
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const info = await getPluginInfoContract(runtime, pluginId);
    if (shouldUseCliPluginRenderer(pluginId, renderMode, "info")) {
      const rendered = renderCliPluginInfo(info);
      if (rendered) {
        return jsonResult(rendered.data, rendered.human);
      }
    }
    return jsonResult(info, formatGenericPluginInfoReport(info));
  });
}

async function runPluginsConfigShowGeneric(
  pluginId: string,
  flags: CliFlags,
  renderMode: CliPluginRenderMode = "auto",
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const info = await getPluginInfoContract(runtime, pluginId);
    if (shouldUseCliPluginRenderer(pluginId, renderMode, "config")) {
      const rendered = renderCliPluginConfig({
        info,
        projectSlug: requireProjectSlug(runtime),
      });
      if (rendered) {
        return jsonResult(rendered.data, rendered.human);
      }
    }
    return jsonResult(
      info.config,
      formatGenericPluginConfigReport({
        pluginId,
        pluginName: info.catalog.name,
        projectSlug: requireProjectSlug(runtime),
        config: info.config,
        enabled: info.enabled,
        entitled: info.entitled,
      }),
    );
  });
}

async function runPluginsConfigTemplateGeneric(
  pluginId: string,
  flags: CliFlags,
  renderMode: CliPluginRenderMode = "auto",
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    if (shouldUseCliPluginRenderer(pluginId, renderMode, "configTemplate")) {
      const rendered = renderCliPluginConfigTemplate({
        pluginId,
      });
      if (rendered) {
        return jsonResult(rendered.data, rendered.human);
      }
    }
    const info = await getPluginInfoContract(runtime, pluginId);
    if (shouldUseCliPluginRenderer(pluginId, renderMode, "configTemplate")) {
      const rendered = renderCliPluginConfigTemplate({
        pluginId,
        info,
      });
      if (rendered) {
        return jsonResult(rendered.data, rendered.human);
      }
    }
    return jsonResult(
      info.defaultConfig,
      formatGenericPluginConfigTemplateReport({
        pluginId,
        pluginName: info.catalog.name,
        defaultConfig: info.defaultConfig,
      }),
    );
  });
}

async function runPluginsConfigureGeneric(
  pluginId: string,
  flags: CliFlags,
  cwd: string,
  renderMode: CliPluginRenderMode = "auto",
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const filePath = flags.file?.trim();
    if (!filePath) {
      throw new Error(`plugins config apply ${pluginId} requires --file <config.json|->`);
    }

    const config = await readJsonFile(filePath === "-" ? "-" : resolveInputPath(filePath, cwd));
    const result = (await runtime.client.mutation("studioApi.updateProjectPluginConfig", {
      studioId: runtime.config.studioId,
      slug,
      pluginId,
      config,
    })) as PluginCliInfoContractPayload;
    if (shouldUseCliPluginRenderer(pluginId, renderMode, "configUpdate")) {
      const rendered = renderCliPluginConfigUpdate({
        pluginId,
        info: result,
        projectSlug: slug,
      });
      if (rendered) {
        return jsonResult(rendered.data, rendered.human);
      }
    }

    return jsonResult(
      result,
      formatGenericPluginConfigUpdateReport({
        pluginId,
        pluginName: result.catalog.name,
        projectSlug: slug,
      }),
    );
  });
}

async function runPluginActionGeneric(
  pluginId: string,
  actionId: string,
  args: string[],
  flags: CliFlags,
  renderMode: CliPluginRenderMode = "auto",
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const result = (await runtime.client.mutation("studioApi.runProjectPluginAction", {
      studioId: runtime.config.studioId,
      slug,
      pluginId,
      actionId,
      args,
    })) as PluginActionResponse;
    if (shouldUseCliPluginRenderer(pluginId, renderMode, "action")) {
      const rendered = renderCliPluginAction(result);
      if (rendered) {
        return jsonResult(rendered.data, rendered.human);
      }
    }

    return jsonResult(result, formatGenericPluginActionReport(result));
  });
}

async function runResolvedCliPluginAlias(
  tokensAfterPlugins: string[],
  flags: CliFlags,
  cwd: string,
): Promise<CommandResult | null> {
  const match = resolveCliPluginAlias(tokensAfterPlugins);
  if (!match) return null;

  switch (match.target.kind) {
    case "info":
      return runPluginsInfoGeneric(match.pluginId, flags, match.renderMode);
    case "config_show":
      return runPluginsConfigShowGeneric(match.pluginId, flags, match.renderMode);
    case "config_template":
      return runPluginsConfigTemplateGeneric(match.pluginId, flags, match.renderMode);
    case "config_apply":
      return runPluginsConfigureGeneric(match.pluginId, flags, cwd, match.renderMode);
    case "action":
      return runPluginActionGeneric(
        match.pluginId,
        match.target.actionId,
        match.args,
        flags,
        match.renderMode,
      );
  }
}

async function runPublishChecklistShow(flags: CliFlags): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const version = requireProjectVersion(runtime);
    const result = (await runtime.client.query("studioApi.getPublishChecklist", {
      studioId: runtime.config.studioId,
      slug,
      version,
    })) as PublishChecklistQueryResponse;

    return jsonResult(result, formatPublishChecklistReport(result));
  });
}

async function runPublishChecklistRun(flags: CliFlags): Promise<CommandResult> {
  const slug = requireResolvedProjectSlug(flags);
  const version = requireResolvedProjectVersion(flags);
  const result = await callLocalStudioMutation<PublishChecklistRunResponse>(
    "agent.runPrePublishChecklist",
    {
      projectSlug: slug,
      version,
    },
  );

  return jsonResult(
    result,
    formatPublishChecklistRunReport({
      sessionId: result.sessionId,
      checklist: result.checklist,
    }),
  );
}

async function runPublishChecklistUpdate(
  flags: CliFlags,
  itemId: string,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const version = requireProjectVersion(runtime);
    const status = flags.status?.trim().toLowerCase();
    if (!isChecklistStatus(status)) {
      throw new Error(
        "publish checklist update requires --status <pass|fail|warning|skip|fixed>",
      );
    }

    const result = (await runtime.client.mutation(
      "studioApi.updatePublishChecklistItem",
      {
        studioId: runtime.config.studioId,
        slug,
        version,
        itemId,
        status,
        note: flags.note ?? undefined,
      },
    )) as PublishChecklistUpdateResponse;

    return jsonResult(result, formatPublishChecklistUpdateReport(result));
  });
}

async function runHelp(flags: CliFlags, tokens: string[]): Promise<CommandResult> {
  const topic = resolveHelpTopic(tokens);
  const normalized = topic.join(" ").trim() || "root";
  const help = helpTextFor(topic);
  return jsonResult({ topic: normalized, help }, help);
}

export async function dispatchCli(
  argv: string[],
  cwd: string = process.cwd(),
): Promise<CommandResult> {
  const parsed = parseCliArgs(argv);
  if (parsed.unknownFlags.length > 0) {
    throw new Error(`Unknown flag(s): ${parsed.unknownFlags.join(", ")}`);
  }

  const tokens = parsed.tokens;
  if (isHelpRequested(tokens, parsed.flags)) {
    return runHelp(parsed.flags, tokens);
  }

  const [head, second, third, ...rest] = tokens;

  switch (head) {
    case undefined:
    case "help":
      return runHelp(parsed.flags, tokens);
    case "doctor":
      return runDoctor(parsed.flags);
    case "whoami":
      return runWhoami(parsed.flags);
    case "project":
      if (second !== "info") {
        throw new Error("Unknown project command. Try `vivd project info`.");
      }
      return runProjectInfo(parsed.flags);
    case "cms":
      if (second === "status") {
        return runCmsStatus(cwd);
      }
      if (second === "validate") {
        return runCmsValidate(cwd);
      }
      if (second === "build-artifacts") {
        return runCmsBuildArtifacts(cwd);
      }
      if (second === "scaffold" && third === "init") {
        return runCmsScaffoldInit(cwd);
      }
      if (second === "scaffold" && third === "model" && rest[0]) {
        return runCmsScaffoldModel(rest[0], cwd);
      }
      if (second === "scaffold" && third === "entry" && rest[0] && rest[1]) {
        return runCmsScaffoldEntry(rest[0], rest[1], cwd);
      }
      throw new Error("Unknown cms command. Try `vivd cms help`.");
    case "preview":
      if (second === "status") {
        return runPreviewStatus(parsed.flags);
      }
      if (second === "logs") {
        return runPreviewLogs(third, parsed.flags);
      }
      if (second === "screenshot") {
        if (!isPreviewScreenshotCliEnabled()) {
          throw new Error("Unknown preview command. Try `vivd preview help`.");
        }
        return runPreviewScreenshot(third, parsed.flags, cwd);
      }
      throw new Error("Unknown preview command. Try `vivd preview help`.");
    case "plugins":
      if (second === "catalog") {
        return runPluginsCatalog(parsed.flags);
      }
      {
        const aliasResult = await runResolvedCliPluginAlias(tokens.slice(1), parsed.flags, cwd);
        if (aliasResult) {
          return aliasResult;
        }
      }
      if (second === "info" && third) {
        return runPluginsInfoGeneric(third, parsed.flags);
      }
      if (second === "config" && third === "show" && rest[0]) {
        return runPluginsConfigShowGeneric(rest[0], parsed.flags);
      }
      if (second === "config" && third === "template" && rest[0]) {
        return runPluginsConfigTemplateGeneric(rest[0], parsed.flags);
      }
      if (second === "config" && third === "apply" && rest[0]) {
        return runPluginsConfigureGeneric(rest[0], parsed.flags, cwd);
      }
      if (second === "action" && third && rest[0]) {
        return runPluginActionGeneric(third, rest[0], rest.slice(1), parsed.flags);
      }
      throw new Error("Unknown plugins command. Try `vivd plugins help`.");
    case "publish":
      if (second === "checklist" && third === "run") {
        return runPublishChecklistRun(parsed.flags);
      }
      if (second === "checklist" && third === "show") {
        return runPublishChecklistShow(parsed.flags);
      }
      if (second === "checklist" && third === "update" && rest[0]) {
        return runPublishChecklistUpdate(parsed.flags, rest[0]);
      }
      throw new Error("Unknown publish command. Try `vivd publish help`.");
    default:
      throw new Error(`Unknown command: ${head}. Try \`vivd help\`.`);
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const result = await dispatchCli(argv);
    if (parseCliArgs(argv).flags.json) {
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      console.log(result.human);
    }
    return result.exitCode ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}
