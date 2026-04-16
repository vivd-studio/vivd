import fs from "node:fs/promises";
import path from "node:path";
import {
  renderVivdCliRootHelp,
  validateConnectedStudioBackendClientConfig,
} from "@vivd/shared/studio";
import { parseCliArgs, resolveHelpTopic, isHelpRequested, type CliFlags } from "./args.js";
import { resolveCliRuntime } from "./backend.js";
import {
  getCmsStatus,
  getCmsToolkitStatus,
  installCmsBindingHelper,
  scaffoldCmsEntry,
  scaffoldCmsModel,
  scaffoldCmsWorkspace,
  validateCmsWorkspace,
} from "./cms.js";
import {
  formatCmsScaffoldReport,
  formatCmsStatusReport,
  formatCmsToolkitStatusReport,
  formatCmsValidateReport,
  formatDoctorReport,
  formatGenericPluginActionReport,
  formatGenericPluginConfigReport,
  formatGenericPluginConfigTemplateReport,
  formatGenericPluginConfigUpdateReport,
  formatGenericPluginInfoReport,
  formatGenericPluginReadReport,
  formatPluginCatalogReport,
  formatPreviewLogsReport,
  formatPreviewScreenshotReport,
  formatPreviewStatusReport,
  formatProjectInfoReport,
  formatPublishChecklistReport,
  formatPublishChecklistRunReport,
  formatPublishChecklistUpdateReport,
  formatPublishDeployReport,
  formatPublishPrepareReport,
  formatPluginSnippetsReport,
  formatPublishStatusReport,
  formatPublishTargetsReport,
  formatPublishUnpublishReport,
  formatSupportRequestReport,
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
import type {
  PluginCliInfoContractPayload,
  PluginCliReadResultPayload,
} from "@vivd/plugin-sdk";

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

type SupportContactResponse = {
  supportEmail: string | null;
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
  stale?: boolean;
  reason?: "missing" | "project_updated" | "hash_mismatch" | null;
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

type PublishStatusResponse = {
  isPublished: boolean;
  domain: string | null;
  commitHash: string | null;
  publishedAt: string | null;
  url: string | null;
  projectVersion?: number | null;
};

type PublishStateResponse = {
  storageEnabled: boolean;
  readiness:
    | "ready"
    | "build_in_progress"
    | "artifact_not_ready"
    | "not_found"
    | "unsupported"
    | "storage_disabled";
  sourceKind: string;
  framework: string;
  publishableCommitHash: string | null;
  lastSyncedCommitHash: string | null;
  builtAt: string | null;
  sourceBuiltAt: string | null;
  previewBuiltAt: string | null;
  error: string | null;
  studioRunning: boolean;
  studioStateAvailable: boolean;
  studioHasUnsavedChanges: boolean;
  studioHeadCommitHash: string | null;
  studioWorkingCommitHash: string | null;
  studioStateReportedAt: string | null;
};

type CheckDomainResponse = {
  available: boolean;
  normalizedDomain: string;
  error?: string;
};

type PublishTargetsResponse = {
  projectSlug: string;
  currentPublishedDomain: string | null;
  recommendedDomain: string | null;
  targets: Array<{
    domain: string;
    usage: "tenant_host" | "publish_target";
    type: "managed_subdomain" | "custom_domain" | "implicit_primary_host";
    status: "active" | "disabled" | "pending_verification" | "implicit";
    current: boolean;
    primaryHost: boolean;
    available: boolean;
    blockedReason?: string;
    url: string;
    recommended: boolean;
  }>;
};

type PublishDeployResponse = {
  success: boolean;
  domain: string;
  commitHash: string;
  url: string;
  message: string;
  github?: unknown;
};

type GitSaveResponse = {
  success: boolean;
  hash: string;
  noChanges: boolean;
  github?: {
    attempted: boolean;
    success: boolean;
    repo?: string;
    remoteUrl?: string;
    error?: string;
  };
  message: string;
};

type PublishUnpublishResponse = {
  success: boolean;
  message: string;
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

type SupportRequestDraft = {
  recipient: string;
  subject: string;
  summary: string;
  note?: string | null;
  projectSlug: string | null;
  projectVersion: number | null;
  enabledPluginIds: string[];
  body: string;
  mailtoUrl: string;
  permissionRequired: true;
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
      reads?: Array<{
        readId: string;
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
    "vivd plugins snippets <pluginId> [snippetName]",
    "vivd plugins read <pluginId> <readId> [--file input.json]",
    "vivd plugins config show <pluginId>",
    "vivd plugins config template <pluginId>",
    "vivd plugins config apply <pluginId> --file config.json",
    "vivd plugins action <pluginId> <actionId> [args...]",
    "Current first-party shortcut examples:",
    "vivd plugins contact info",
    "vivd plugins snippets contact_form html",
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
    "vivd cms helper status",
    "vivd cms helper install",
    "For Astro-backed projects, Vivd CMS reads Astro Content Collections from src/content.config.ts and entry files under src/content/**.",
    "Use `vivd cms helper status` to inspect whether the local CMS preview toolkit is current before CMS/localization work.",
    "Use `vivd cms helper install` to add or refresh the local CMS preview toolkit: src/lib/cmsBindings.ts plus src/lib/cms/CmsText.astro and src/lib/cms/CmsImage.astro.",
    "Bind actual CMS-owned render points, not generic layout wrappers.",
    "Use collection-backed CMS content selectively for structured, repeatable, user-managed domains like products, blogs, directories, downloads, or case studies.",
  ].join("\n"),
  publish: [
    "vivd publish status",
    "vivd publish targets",
    "vivd publish prepare",
    "vivd publish deploy [--domain <domain>]",
    "vivd publish unpublish",
    "vivd publish checklist run",
    "vivd publish checklist show",
    "vivd publish checklist update <item-id> --status <status> [--note ...]",
    "Use `status` to inspect whether the current saved Studio snapshot is ready to publish, plus the prepared commit and checklist freshness.",
    "Use `targets` to inspect recommended and eligible domains for the current project before deploying.",
    "Use `prepare` to save current Studio changes if needed and wait until the current saved snapshot is prepared for publish.",
    "Use `deploy` to publish the current saved, prepared snapshot. It does not auto-save. Pass --domain to choose a target; without it, deploy reuses the current published domain or the only available target.",
    "Use `unpublish` to remove the site from its published domain.",
    "Use `run` only when the user explicitly asks for a full checklist run or rerun; it is slower and more expensive than normal checks.",
    "Use `show` and `update` to inspect or continue checklist items one by one without starting a new full run.",
    "From Studio agent chat, `deploy`, `unpublish`, and `checklist run` require explicit approval before they execute.",
    "Allowed statuses: pass, fail, warning, skip, fixed",
    "Use --slug and --version (or VIVD_PROJECT_SLUG / VIVD_PROJECT_VERSION). Use --domain when you need to choose among multiple targets or switch domains.",
  ].join("\n"),
  support: [
    "vivd support request <summary...>",
    "Draft a support email using the configured support address and current project context.",
    "Always ask the user for explicit permission before contacting support on their behalf.",
    "Optional flags: --note",
    'Example: vivd support request enable analytics for this project --note "Customer approved contacting support"',
  ].join("\n"),
};

function jsonResult(data: unknown, human: string, exitCode?: number): CommandResult {
  return { data, human, exitCode };
}

const PUBLISH_PREPARE_MESSAGE = "Prepare publish artifacts";
const PUBLISH_PREPARE_TIMEOUT_MS = 90_000;
const PUBLISH_PREPARE_POLL_INTERVAL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function getRootHelpText(options?: {
  env?: NodeJS.ProcessEnv;
  supportRequestEnabled?: boolean;
}): string {
  const env = options?.env ?? process.env;
  return renderVivdCliRootHelp({
    previewScreenshotEnabled: isPreviewScreenshotCliEnabled(env),
    supportRequestEnabled:
      options?.supportRequestEnabled ?? isSupportRequestEnabledFromEnv(env),
  });
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

function getSupportHelpText(): string {
  return GENERAL_HELP.support;
}

function readConfiguredSupportEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = (env.VIVD_EMAIL_BRAND_SUPPORT_EMAIL || "").trim();
  return configured || null;
}

function isSupportRequestEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(readConfiguredSupportEmail(env));
}

async function resolveSupportEmail(
  flags: Pick<CliFlags, "slug" | "version">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const configured = readConfiguredSupportEmail(env);
  if (configured) {
    return configured;
  }

  const runtime = resolveCliRuntime(env, flags);
  if (!runtime) {
    return null;
  }

  try {
    const result = (await runtime.client.query("studioApi.getSupportContact", {
      studioId: runtime.config.studioId,
    })) as SupportContactResponse;
    const supportEmail = result.supportEmail?.trim();
    return supportEmail || null;
  } catch {
    return null;
  }
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

function buildLocalStudioHeaders(
  env: NodeJS.ProcessEnv = process.env,
  options?: { includeContentType?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options?.includeContentType !== false) {
    headers["Content-Type"] = "application/json";
  }
  const studioAccessToken = env.STUDIO_ACCESS_TOKEN?.trim();
  if (studioAccessToken) {
    headers["x-vivd-studio-token"] = studioAccessToken;
  }
  return headers;
}

async function callLocalStudioQuery<T>(
  procedure: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const response = await fetch(
    `${getLocalStudioTrpcBaseUrl(env)}/${procedure}?input=${encodeURIComponent(
      JSON.stringify(input),
    )}`,
    {
      method: "GET",
      headers: buildLocalStudioHeaders(env, { includeContentType: false }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`${procedure} failed (${response.status}): ${errorText}`);
  }

  const body = await response.json().catch(() => null);
  return unwrapTrpcBody(body) as T;
}

async function callLocalStudioMutation<T>(
  procedure: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const response = await fetch(`${getLocalStudioTrpcBaseUrl(env)}/${procedure}`, {
    method: "POST",
    headers: buildLocalStudioHeaders(env),
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

function derivePublishDeploymentState(state: PublishStateResponse) {
  const studioStateUnknownWarning = Boolean(
    state.studioRunning && state.studioStateAvailable === false,
  );
  const olderSnapshotInStudio = Boolean(
    state.studioRunning &&
      state.studioStateAvailable &&
      state.studioWorkingCommitHash &&
      state.studioHeadCommitHash &&
      state.studioWorkingCommitHash !== state.studioHeadCommitHash,
  );
  const unsavedChangesInStudio = Boolean(
    state.studioRunning &&
      state.studioStateAvailable &&
      state.studioHasUnsavedChanges,
  );
  const targetCommitHash =
    state.studioRunning && state.studioStateAvailable && state.studioHeadCommitHash
      ? state.studioHeadCommitHash
      : state.publishableCommitHash ?? null;
  const publishableCommitMatchesTarget = Boolean(
    targetCommitHash &&
      state.publishableCommitHash &&
      state.publishableCommitHash === targetCommitHash,
  );
  const stalePreparedSnapshot = Boolean(
    state.readiness === "ready" &&
      targetCommitHash &&
      state.publishableCommitHash &&
      state.publishableCommitHash !== targetCommitHash &&
      !studioStateUnknownWarning &&
      !olderSnapshotInStudio &&
      !unsavedChangesInStudio,
  );
  const missingPublishableSnapshot = Boolean(
    state.readiness === "ready" &&
      !state.publishableCommitHash &&
      !studioStateUnknownWarning &&
      !olderSnapshotInStudio &&
      !unsavedChangesInStudio,
  );

  return {
    studioStateUnknownWarning,
    olderSnapshotInStudio,
    unsavedChangesInStudio,
    targetCommitHash,
    publishableCommitMatchesTarget,
    stalePreparedSnapshot,
    missingPublishableSnapshot,
    canPublishNow:
      state.storageEnabled &&
      state.readiness === "ready" &&
      !studioStateUnknownWarning &&
      !unsavedChangesInStudio &&
      !olderSnapshotInStudio &&
      publishableCommitMatchesTarget,
  };
}

function getPublishDisabledReason(state: PublishStateResponse): string | null {
  const derived = derivePublishDeploymentState(state);

  if (!state.storageEnabled) {
    return "Publishing isn't available right now.";
  }

  if (state.readiness !== "ready") {
    if (state.readiness === "build_in_progress") {
      return "Your latest build is still in progress.";
    }
    if (state.readiness === "artifact_not_ready") {
      return "Your latest changes are still being prepared for publishing.";
    }
    if (state.readiness === "not_found") {
      return "No prepared publish artifact exists for the current saved snapshot.";
    }
    return "Publishing is not ready for this project yet.";
  }

  if (derived.studioStateUnknownWarning) {
    return "Studio is still loading. Please wait a little while.";
  }
  if (derived.olderSnapshotInStudio) {
    return "You're viewing an older snapshot. Restore it before publishing.";
  }
  if (derived.unsavedChangesInStudio) {
    return "You have unsaved changes. Save your changes before publishing.";
  }
  if (derived.missingPublishableSnapshot || !derived.targetCommitHash) {
    return "No publishable version found.";
  }
  if (!derived.publishableCommitMatchesTarget) {
    return "Your latest changes are still being prepared for publishing. Please wait a little while.";
  }

  return null;
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

async function helpTextFor(
  topic: string[],
  flags: Pick<CliFlags, "slug" | "version">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const normalized = topic.join(" ").trim();
  let supportRequestEnabled: boolean | null = null;
  const getSupportRequestEnabled = async (): Promise<boolean> => {
    if (supportRequestEnabled == null) {
      supportRequestEnabled = Boolean(await resolveSupportEmail(flags, env));
    }
    return supportRequestEnabled;
  };

  if (!normalized || normalized === "root") {
    return getRootHelpText({
      env,
      supportRequestEnabled: await getSupportRequestEnabled(),
    });
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
  if (normalized.startsWith("support")) {
    if (!(await getSupportRequestEnabled())) {
      return "Support contact is not configured for this runtime.";
    }
    return getSupportHelpText();
  }
  return getRootHelpText({
    env,
    supportRequestEnabled: await getSupportRequestEnabled(),
  });
}

function buildSupportRequestSubject(projectSlug: string | null): string {
  return projectSlug ? `Vivd support request for ${projectSlug}` : "Vivd support request";
}

function buildSupportRequestBody(input: {
  summary: string;
  note?: string | null;
  projectSlug: string | null;
  projectVersion: number | null;
  enabledPluginIds: string[];
}): string {
  const lines = [
    "Hello Vivd support,",
    "",
    input.summary,
    "",
    `Project: ${input.projectSlug ?? "n/a"}`,
    `Version: ${input.projectVersion ?? "n/a"}`,
    `Enabled plugins: ${
      input.enabledPluginIds.length > 0 ? input.enabledPluginIds.join(", ") : "none"
    }`,
  ];

  if (input.note?.trim()) {
    lines.push("", `Additional note: ${input.note.trim()}`);
  }

  lines.push("", "Prepared from the Vivd CLI after explicit user approval to contact support.");
  return lines.join("\n");
}

function buildMailtoUrl(recipient: string, subject: string, body: string): string {
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function runCmsStatus(cwd: string): Promise<CommandResult> {
  const report = await getCmsStatus(cwd);
  return jsonResult(
    report,
    formatCmsStatusReport({
      sourceKind: report.sourceKind,
      initialized: report.initialized,
      valid: report.valid,
      contentRoot: report.paths.contentRoot,
      toolkit: report.toolkit,
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

async function runCmsHelperStatus(cwd: string): Promise<CommandResult> {
  const report = await getCmsToolkitStatus(cwd);
  return jsonResult(report, formatCmsToolkitStatusReport(report), report.needsInstall ? 1 : 0);
}

async function runCmsValidate(cwd: string): Promise<CommandResult> {
  const report = await validateCmsWorkspace(cwd);
  return jsonResult(
    report,
    formatCmsValidateReport({
      sourceKind: report.sourceKind,
      valid: report.valid,
      modelCount: report.modelCount,
      entryCount: report.entryCount,
      assetCount: report.assetCount,
      errors: report.errors,
    }),
    report.valid ? 0 : 1,
  );
}

async function runCmsHelperInstall(cwd: string): Promise<CommandResult> {
  const result = await installCmsBindingHelper(cwd);
  return jsonResult(
    result,
    formatCmsScaffoldReport({
      title:
        result.created.length > 0
          ? "CMS preview toolkit installed."
          : "CMS preview toolkit already present.",
      created: result.created,
      skipped: result.skipped,
    }),
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

function normalizeSnippetEntries(
  snippets: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!snippets || typeof snippets !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(snippets).filter(([, value]) => value != null),
  );
}

async function runPluginSnippetsGeneric(
  pluginId: string,
  snippetName: string | undefined,
  flags: CliFlags,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const info = await getPluginInfoContract(runtime, pluginId);
    const snippets = normalizeSnippetEntries(info.snippets);
    const availableSnippetNames = Object.keys(snippets);

    if (availableSnippetNames.length === 0) {
      throw new Error(
        `Plugin ${pluginId} does not have install snippets available right now.`,
      );
    }

    const requestedSnippetName =
      (snippetName ?? flags.format ?? "").trim() || null;
    if (requestedSnippetName && !(requestedSnippetName in snippets)) {
      throw new Error(
        `Unknown snippet "${requestedSnippetName}" for plugin ${pluginId}. Available snippets: ${availableSnippetNames.join(", ")}.`,
      );
    }

    const data = requestedSnippetName
      ? {
          pluginId,
          pluginName: info.catalog.name,
          snippetName: requestedSnippetName,
          snippet: snippets[requestedSnippetName],
          availableSnippetNames,
        }
      : {
          pluginId,
          pluginName: info.catalog.name,
          snippets,
          availableSnippetNames,
        };

    return jsonResult(
      data,
      formatPluginSnippetsReport({
        pluginId,
        pluginName: info.catalog.name,
        selectedSnippetName: requestedSnippetName,
        snippets,
      }),
    );
  });
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

async function runPluginReadGeneric(
  pluginId: string,
  readId: string,
  flags: CliFlags,
  cwd: string,
): Promise<CommandResult> {
  return withRuntime(flags, async (runtime) => {
    const slug = requireProjectSlug(runtime);
    const filePath = flags.file?.trim();
    const input =
      filePath == null
        ? {}
        : await readJsonFile(filePath === "-" ? "-" : resolveInputPath(filePath, cwd));
    const result = (await runtime.client.query("studioApi.getProjectPluginRead", {
      studioId: runtime.config.studioId,
      slug,
      pluginId,
      readId,
      input,
    })) as PluginCliReadResultPayload;

    return jsonResult(result, formatGenericPluginReadReport(result));
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

async function runPublishStatus(flags: CliFlags): Promise<CommandResult> {
  const slug = requireResolvedProjectSlug(flags);
  const version = requireResolvedProjectVersion(flags);
  const [status, state, checklist] = await Promise.all([
    callLocalStudioQuery<PublishStatusResponse>("project.publishStatus", { slug }),
    callLocalStudioQuery<PublishStateResponse>("project.publishState", {
      slug,
      version,
    }),
    callLocalStudioQuery<PublishChecklistQueryResponse>("project.publishChecklist", {
      slug,
      version,
    }),
  ]);
  const derived = derivePublishDeploymentState(state);
  const normalizedChecklist: {
    checklist: PublishChecklist | null;
    stale: boolean;
    reason?: "missing" | "project_updated" | "hash_mismatch" | null;
  } = {
    checklist: checklist.checklist,
    stale: checklist.stale ?? false,
    reason: checklist.reason,
  };

  return jsonResult(
    {
      projectSlug: slug,
      version,
      status,
      state,
      checklist: normalizedChecklist,
      targetCommitHash: derived.targetCommitHash,
      publishReady: derived.canPublishNow,
      blockedReason: getPublishDisabledReason(state),
    },
    formatPublishStatusReport({
      projectSlug: slug,
      version,
      status,
      state,
      checklist: normalizedChecklist,
      targetCommitHash: derived.targetCommitHash,
      publishReady: derived.canPublishNow,
      blockedReason: getPublishDisabledReason(state),
    }),
  );
}

async function runPublishTargets(flags: CliFlags): Promise<CommandResult> {
  const slug = requireResolvedProjectSlug(flags);
  const result = await callLocalStudioQuery<PublishTargetsResponse>(
    "project.publishTargets",
    { slug },
  );

  return jsonResult(
    result,
    formatPublishTargetsReport({
      projectSlug: result.projectSlug,
      currentPublishedDomain: result.currentPublishedDomain,
      recommendedDomain: result.recommendedDomain,
      targets: result.targets,
    }),
  );
}

async function runPublishPrepare(flags: CliFlags): Promise<CommandResult> {
  const slug = requireResolvedProjectSlug(flags);
  const version = requireResolvedProjectVersion(flags);

  let state = await callLocalStudioQuery<PublishStateResponse>("project.publishState", {
    slug,
    version,
  });
  let derived = derivePublishDeploymentState(state);

  if (!state.storageEnabled) {
    throw new Error("Publishing isn't available right now.");
  }
  if (derived.studioStateUnknownWarning) {
    throw new Error("Studio is still loading. Please wait a little while.");
  }
  if (derived.olderSnapshotInStudio) {
    throw new Error("You're viewing an older snapshot. Restore it before publishing.");
  }

  let action:
    | "already_prepared"
    | "saved_changes"
    | "requested_artifact_prepare"
    | "waiting_for_existing_prepare" = "already_prepared";
  let saveResult: GitSaveResponse | null = null;

  if (!derived.canPublishNow) {
    const needsSave = derived.unsavedChangesInStudio;
    const needsPrepareRequest =
      !needsSave &&
      (state.readiness === "artifact_not_ready" ||
        state.readiness === "not_found" ||
        derived.stalePreparedSnapshot ||
        derived.missingPublishableSnapshot);

    if (needsSave || needsPrepareRequest) {
      saveResult = await callLocalStudioMutation<GitSaveResponse>("project.gitSave", {
        slug,
        version,
        message: PUBLISH_PREPARE_MESSAGE,
      });
      action = needsSave ? "saved_changes" : "requested_artifact_prepare";
    } else {
      action = "waiting_for_existing_prepare";
    }

    const deadline = Date.now() + PUBLISH_PREPARE_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      state = await callLocalStudioQuery<PublishStateResponse>("project.publishState", {
        slug,
        version,
      });
      derived = derivePublishDeploymentState(state);

      if (derived.canPublishNow) {
        break;
      }
      if (!state.storageEnabled) {
        throw new Error("Publishing isn't available right now.");
      }
      if (derived.studioStateUnknownWarning) {
        await sleep(PUBLISH_PREPARE_POLL_INTERVAL_MS);
        continue;
      }
      if (derived.olderSnapshotInStudio) {
        throw new Error("You're viewing an older snapshot. Restore it before publishing.");
      }
      if (derived.unsavedChangesInStudio) {
        if (action === "saved_changes") {
          await sleep(PUBLISH_PREPARE_POLL_INTERVAL_MS);
          continue;
        }
        throw new Error("You have unsaved changes. Save your changes before publishing.");
      }

      await sleep(PUBLISH_PREPARE_POLL_INTERVAL_MS);
    }
  }

  if (!derived.canPublishNow) {
    const reason = getPublishDisabledReason(state) || "Publishing is still not ready.";
    const detail = state.error?.trim();
    throw new Error(detail ? `${reason} (${detail})` : reason);
  }

  return jsonResult(
    {
      projectSlug: slug,
      version,
      action,
      state,
      targetCommitHash: derived.targetCommitHash,
      publishReady: derived.canPublishNow,
      saveResult,
    },
    formatPublishPrepareReport({
      projectSlug: slug,
      version,
      action,
      targetCommitHash: derived.targetCommitHash,
      preparedCommitHash: state.publishableCommitHash,
      readyToPublish: derived.canPublishNow,
      saveMessage: saveResult?.message ?? null,
    }),
  );
}

async function runPublishDeploy(flags: CliFlags): Promise<CommandResult> {
  const slug = requireResolvedProjectSlug(flags);
  const version = requireResolvedProjectVersion(flags);
  const [targets, state] = await Promise.all([
    callLocalStudioQuery<PublishTargetsResponse>("project.publishTargets", { slug }),
    callLocalStudioQuery<PublishStateResponse>("project.publishState", {
      slug,
      version,
    }),
  ]);

  const disabledReason = getPublishDisabledReason(state);
  if (disabledReason) {
    throw new Error(disabledReason);
  }

  const derived = derivePublishDeploymentState(state);
  if (!derived.targetCommitHash) {
    throw new Error("No publishable version found.");
  }

  let selectedDomain: string | null = null;

  if ((flags.domain ?? "").trim()) {
    const domainCheck = await callLocalStudioQuery<CheckDomainResponse>(
      "project.checkDomain",
      {
        slug,
        domain: flags.domain!.trim(),
      },
    );
    if (!domainCheck.available) {
      throw new Error(domainCheck.error || "Enter a valid domain.");
    }

    const matchingTarget = targets.targets.find(
      (target) => target.domain === domainCheck.normalizedDomain,
    );
    if (matchingTarget && !matchingTarget.available) {
      throw new Error(matchingTarget.blockedReason || "Domain is not available for publishing.");
    }

    selectedDomain = domainCheck.normalizedDomain;
  } else if (targets.currentPublishedDomain) {
    const currentTarget = targets.targets.find(
      (target) => target.domain === targets.currentPublishedDomain,
    );
    if (!currentTarget) {
      selectedDomain = targets.currentPublishedDomain;
    } else if (currentTarget.available) {
      selectedDomain = currentTarget.domain;
    } else {
      throw new Error(
        currentTarget.blockedReason ||
          "The current published domain is not available for publishing right now.",
      );
    }
  }

  if (!selectedDomain) {
    const availableTargets = targets.targets.filter((target) => target.available);
    if (availableTargets.length === 1) {
      selectedDomain = availableTargets[0]!.domain;
    } else if (availableTargets.length === 0) {
      throw new Error(
        "No publish target is currently available. Run `vivd publish targets` to inspect blocked domains and publishable options.",
      );
    } else {
      throw new Error(
        "Multiple publish targets are available. Run `vivd publish targets` and pass --domain <domain>.",
      );
    }
  }

  const result = await callLocalStudioMutation<PublishDeployResponse>(
    "project.publish",
    {
      slug,
      version,
      domain: selectedDomain,
      expectedCommitHash: derived.targetCommitHash,
    },
  );

  return jsonResult(
    result,
    formatPublishDeployReport({
      domain: result.domain,
      url: result.url,
      commitHash: result.commitHash,
      message: result.message,
    }),
  );
}

async function runPublishUnpublish(flags: CliFlags): Promise<CommandResult> {
  const slug = requireResolvedProjectSlug(flags);
  const status = await callLocalStudioQuery<PublishStatusResponse>(
    "project.publishStatus",
    { slug },
  );

  if (!status.isPublished) {
    const result = {
      success: true,
      alreadyUnpublished: true,
      message: "No published site exists for this project.",
      domain: null,
      url: null,
    };
    return jsonResult(result, formatPublishUnpublishReport(result));
  }

  const result = await callLocalStudioMutation<PublishUnpublishResponse>(
    "project.unpublish",
    { slug },
  );

  return jsonResult(
    {
      ...result,
      domain: status.domain,
      url: status.url,
    },
    formatPublishUnpublishReport({
      message: result.message,
      domain: status.domain,
      url: status.url,
    }),
  );
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

async function runSupportRequest(
  summaryTokens: string[],
  flags: CliFlags,
): Promise<CommandResult> {
  const recipient = await resolveSupportEmail(flags);
  if (!recipient) {
    throw new Error("Support contact is not configured for this runtime.");
  }

  const summary = summaryTokens.join(" ").trim();
  if (!summary) {
    throw new Error(
      "support request requires a summary. Try `vivd support request enable analytics for this project`.",
    );
  }

  const note = flags.note?.trim() || null;
  const fallbackProject = resolveProjectContext(flags);
  let projectSlug = fallbackProject.projectSlug;
  let projectVersion = fallbackProject.projectVersion;
  let enabledPluginIds: string[] = [];

  const runtime = ensureConnectedRuntime(flags);
  if (runtime?.projectSlug) {
    try {
      const info = (await runtime.client.query("studioApi.getProjectInfo", {
        studioId: runtime.config.studioId,
        slug: runtime.projectSlug,
        version: runtime.projectVersion ?? undefined,
      })) as ProjectInfoResponse;
      projectSlug = info.project.slug;
      projectVersion = info.project.requestedVersion;
      enabledPluginIds = info.enabledPluginIds;
    } catch {
      projectSlug = runtime.projectSlug ?? projectSlug;
      projectVersion = runtime.projectVersion ?? projectVersion;
    }
  }

  const subject = buildSupportRequestSubject(projectSlug);
  const body = buildSupportRequestBody({
    summary,
    note,
    projectSlug,
    projectVersion,
    enabledPluginIds,
  });
  const draft: SupportRequestDraft = {
    recipient,
    subject,
    summary,
    note,
    projectSlug,
    projectVersion,
    enabledPluginIds,
    body,
    mailtoUrl: buildMailtoUrl(recipient, subject, body),
    permissionRequired: true,
  };

  return jsonResult(draft, formatSupportRequestReport(draft));
}

async function runHelp(flags: CliFlags, tokens: string[]): Promise<CommandResult> {
  const topic = resolveHelpTopic(tokens);
  const normalized = topic.join(" ").trim() || "root";
  const help = await helpTextFor(topic, flags);
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
      if (second === "helper" && third === "status") {
        return runCmsHelperStatus(cwd);
      }
      if (second === "helper" && third === "install") {
        return runCmsHelperInstall(cwd);
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
      if (second === "snippets" && third) {
        return runPluginSnippetsGeneric(third, rest[0], parsed.flags);
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
      if (
        second === "read" &&
        third &&
        (rest[0] === "snippet" || rest[0] === "snippets")
      ) {
        return runPluginSnippetsGeneric(third, rest[1], parsed.flags);
      }
      if (second === "read" && third && rest[0]) {
        return runPluginReadGeneric(third, rest[0], parsed.flags, cwd);
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
      if (second === "status") {
        return runPublishStatus(parsed.flags);
      }
      if (second === "targets") {
        return runPublishTargets(parsed.flags);
      }
      if (second === "prepare") {
        return runPublishPrepare(parsed.flags);
      }
      if (second === "deploy") {
        return runPublishDeploy(parsed.flags);
      }
      if (second === "unpublish") {
        return runPublishUnpublish(parsed.flags);
      }
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
    case "support":
      if (second === "request") {
        return runSupportRequest([third, ...rest].filter(Boolean) as string[], parsed.flags);
      }
      throw new Error("Unknown support command. Try `vivd support help`.");
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
