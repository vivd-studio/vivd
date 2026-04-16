import fs from "node:fs";
import path from "node:path";
import {
  isConnectedMode,
  INITIAL_GENERATION_MANIFEST_RELATIVE_PATH,
  SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH,
  SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH,
  SCRATCH_REFERENCE_FILES_RELATIVE_PATH,
  type InitialGenerationState,
  type ScratchInitialGenerationManifest,
} from "@vivd/shared";
import {
  agentEventEmitter,
  deleteSession,
  getSessionContent,
  getSessionsStatus,
  listQuestions,
  listSessions,
  runTask,
  type ModelSelection,
} from "../../opencode/index.js";
import { detectProjectType } from "../project/projectType.js";
import {
  buildAndUploadPreview,
  syncSourceToBucket,
} from "../sync/ArtifactSyncService.js";
import { requestBucketSync } from "../sync/AgentTaskSyncService.js";
import { saveInitialGenerationSnapshot } from "./InitialGenerationSnapshotService.js";
import { thumbnailGenerationReporter } from "../reporting/ThumbnailGenerationReporter.js";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
  type ConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

const startLocks = new Map<string, Promise<StartInitialGenerationResult>>();
const monitoredSessions = new Map<string, () => void>();
const finalizationLocks = new Map<string, Promise<void>>();
const MONITOR_POLL_MS = 5_000;
const TERMINAL_IDLE_GRACE_MS = 10_000;
const DEFAULT_INITIAL_GENERATION_MANIFEST_WAIT_MS = 10_000;
const INITIAL_GENERATION_MANIFEST_POLL_MS = 250;
const INITIAL_GENERATION_RUNTIME_STARTED_AT_MS = Date.now();
const INITIAL_GENERATION_SESSION_START_SYSTEM_PROMPT_SUFFIX = `## Scratch Initial Generation Mode

- This session is for autonomous initial website generation, not collaborative planning.
- Treat the initial generation request as already approved. Do not stop after outlining a plan or ask for approval in normal assistant text.
- Do not ask questions like "Does this plan sound good?" or "Should I continue?".
- Start implementing immediately and keep working until the first complete version of the site is materially built.
- Use the question tool only for a real blocking ambiguity that prevents a production-ready first version. If a reasonable assumption is available, make it and continue.
`;

export type StartInitialGenerationOptions = {
  projectSlug: string;
  version: number;
  workspaceDir: string;
  model?: ModelSelection;
};

export type StartInitialGenerationResult = {
  sessionId: string;
  reused: boolean;
  status: InitialGenerationState;
};

function getConnectedBackendConfig(): ConnectedBackendAuthConfig | null {
  if (!isConnectedMode()) return null;
  return getConnectedBackendAuthConfig();
}

async function callConnectedBackendMutation<T>(
  procedure: string,
  input: Record<string, unknown>,
): Promise<T | null> {
  const config = getConnectedBackendConfig();
  if (!config) return null;

  const response = await fetch(`${config.backendUrl}/api/trpc/${procedure}`, {
    method: "POST",
    headers: buildConnectedBackendHeaders(config),
    body: JSON.stringify({
      studioId: config.studioId,
      ...input,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`${procedure} failed (${response.status}): ${text}`);
  }

  const body = (await response.json().catch(() => null)) as any;
  return (body?.result?.data?.json ?? body?.result?.data ?? body) as T;
}

function getManifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, INITIAL_GENERATION_MANIFEST_RELATIVE_PATH);
}

function readInitialGenerationManifest(
  workspaceDir: string,
): ScratchInitialGenerationManifest {
  const manifestPath = getManifestPath(workspaceDir);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Initial generation manifest not found: ${INITIAL_GENERATION_MANIFEST_RELATIVE_PATH}`,
    );
  }

  return JSON.parse(
    fs.readFileSync(manifestPath, "utf-8"),
  ) as ScratchInitialGenerationManifest;
}

function getInitialGenerationManifestWaitMs(): number {
  const raw = Number.parseInt(
    process.env.VIVD_INITIAL_GENERATION_MANIFEST_WAIT_MS || "",
    10,
  );
  if (!Number.isFinite(raw) || raw < 0) {
    return DEFAULT_INITIAL_GENERATION_MANIFEST_WAIT_MS;
  }
  return raw;
}

function listVivdDirEntries(workspaceDir: string): string {
  const vivdDir = path.join(workspaceDir, ".vivd");
  try {
    const entries = fs.readdirSync(vivdDir).sort();
    return entries.length > 0 ? entries.join(", ") : "(empty)";
  } catch {
    return "(missing)";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readInitialGenerationManifestWithRetry(
  workspaceDir: string,
): Promise<ScratchInitialGenerationManifest> {
  const manifestPath = getManifestPath(workspaceDir);
  const deadline = Date.now() + getInitialGenerationManifestWaitMs();
  let warned = false;

  while (Date.now() <= deadline) {
    if (fs.existsSync(manifestPath)) {
      return readInitialGenerationManifest(workspaceDir);
    }

    if (!warned) {
      warned = true;
      console.warn(
        `[InitialGeneration] Waiting for manifest in ${workspaceDir} (${INITIAL_GENERATION_MANIFEST_RELATIVE_PATH})`,
      );
    }

    await delay(INITIAL_GENERATION_MANIFEST_POLL_MS);
  }

  throw new Error(
    `Initial generation manifest not found: ${INITIAL_GENERATION_MANIFEST_RELATIVE_PATH} (workspace=${workspaceDir}, .vivd=${listVivdDirEntries(workspaceDir)})`,
  );
}

function writeInitialGenerationManifest(
  workspaceDir: string,
  manifest: ScratchInitialGenerationManifest,
): void {
  const manifestPath = getManifestPath(workspaceDir);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

function requestInitialGenerationStateSync(options: {
  workspaceDir: string;
  projectSlug: string;
  version: number;
  manifest: ScratchInitialGenerationManifest;
}): void {
  requestBucketSync("initial-generation-state", {
    projectDir: options.workspaceDir,
    projectSlug: options.projectSlug,
    version: options.version,
    state: options.manifest.state,
    sessionId: options.manifest.sessionId ?? null,
    startedAt: options.manifest.startedAt ?? null,
    completedAt: options.manifest.completedAt ?? null,
  });
}

function persistInitialGenerationManifest(options: {
  workspaceDir: string;
  projectSlug: string;
  version: number;
  manifest: ScratchInitialGenerationManifest;
}): void {
  writeInitialGenerationManifest(options.workspaceDir, options.manifest);
  requestInitialGenerationStateSync(options);
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return (
    extractErrorMessage(record.message) ??
    extractErrorMessage(record.error)
  );
}

function getMessageActivityAt(message: {
  time?: { updated?: number; completed?: number; created?: number };
} | null | undefined): number | null {
  if (!message?.time) {
    return null;
  }

  return (
    message.time.updated ??
    message.time.completed ??
    message.time.created ??
    null
  );
}

function normalizeInitialGenerationFailureMessage(message: string | null): string {
  const trimmed = message?.trim() || "";
  if (!trimmed) {
    return "The agent stopped before finishing the initial generation. Open Studio to continue the session.";
  }

  if (
    /provider_overloaded|json error injected into sse stream|status code 503|temporarily unavailable/i.test(
      trimmed,
    )
  ) {
    return "The AI provider stopped this run before the initial site finished. Open Studio to continue the session.";
  }

  return trimmed;
}

type MonitoredSessionRecord = {
  info?: {
    role?: string;
    time?: {
      created?: number;
      updated?: number;
      completed?: number;
    };
    error?: unknown;
  };
  parts?: Array<{
    type?: string;
    text?: string;
    status?: string;
    state?: { status?: string };
  }>;
  content?: string;
};

function countRecordedAssistantArtifacts(
  messages: MonitoredSessionRecord[],
): number {
  let total = 0;

  for (const message of messages) {
    if (message?.info?.role !== "assistant") {
      continue;
    }

    if (extractErrorMessage(message.info.error)) {
      total += 1;
    }

    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (const part of parts) {
      if (part?.type === "tool") {
        const status =
          typeof part.status === "string"
            ? part.status
            : typeof part.state?.status === "string"
              ? part.state.status
              : null;
        if (status !== "running") {
          total += 1;
        }
        continue;
      }

      if (
        (part?.type === "reasoning" || part?.type === "text") &&
        typeof part.text === "string" &&
        part.text.trim()
      ) {
        total += 1;
      }
    }

    if (
      parts.length === 0 &&
      typeof message.content === "string" &&
      message.content.trim()
    ) {
      total += 1;
    }
  }

  return total;
}

function getEarliestMessageCreatedAt(
  messages: MonitoredSessionRecord[],
): number | null {
  let earliest: number | null = null;

  for (const message of messages) {
    const createdAt = message?.info?.time?.created;
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
      continue;
    }

    earliest =
      earliest == null || createdAt < earliest ? createdAt : earliest;
  }

  return earliest;
}

function shouldTreatZeroActivitySessionAsStaleForThisRuntime(options: {
  sessionStatus:
    | { type: "idle" | "busy" | "done" | "retry" | "error"; message?: string }
    | null;
  hasPendingQuestion: boolean;
  messages: MonitoredSessionRecord[];
  activityCount: number;
}): boolean {
  const sessionStatusType = options.sessionStatus?.type ?? "idle";
  if (sessionStatusType === "busy" || sessionStatusType === "retry") {
    return false;
  }

  if (options.hasPendingQuestion || options.activityCount > 0) {
    return false;
  }

  const earliestMessageCreatedAt = getEarliestMessageCreatedAt(options.messages);
  if (earliestMessageCreatedAt == null) {
    return false;
  }

  return earliestMessageCreatedAt < INITIAL_GENERATION_RUNTIME_STARTED_AT_MS;
}

function deriveMonitoredSessionOutcome(options: {
  sessionStatus:
    | { type: "idle" | "busy" | "done" | "retry" | "error"; message?: string }
    | null;
  messages: MonitoredSessionRecord[];
  hasPendingQuestion: boolean;
  now?: number;
}): {
  state: "active" | "completed" | "interrupted" | "failed";
  errorMessage?: string;
} {
  const activityCount = countRecordedAssistantArtifacts(options.messages);
  const sessionStatusType = options.sessionStatus?.type ?? "idle";
  if (sessionStatusType === "busy" || sessionStatusType === "retry") {
    return { state: "active" };
  }

  if (options.hasPendingQuestion) {
    return { state: "active" };
  }

  const latestAssistant = [...options.messages]
    .reverse()
    .find((message) => message?.info?.role === "assistant");

  if (!latestAssistant?.info) {
    return { state: "active" };
  }

  const assistantError = extractErrorMessage(latestAssistant.info.error);
  if (assistantError) {
    return {
      state: "interrupted",
      errorMessage: normalizeInitialGenerationFailureMessage(assistantError),
    };
  }

  if (sessionStatusType === "error") {
    return {
      state: "interrupted",
      errorMessage: normalizeInitialGenerationFailureMessage(
        options.sessionStatus?.message ?? null,
      ),
    };
  }

  if (typeof latestAssistant.info.time?.completed === "number") {
    return { state: "completed" };
  }

  const latestActivityAt = getMessageActivityAt(latestAssistant.info);
  if (
    activityCount > 0 &&
    latestActivityAt != null &&
    (options.now ?? Date.now()) - latestActivityAt >= TERMINAL_IDLE_GRACE_MS
  ) {
    return {
      state: "interrupted",
      errorMessage: normalizeInitialGenerationFailureMessage(null),
    };
  }

  return { state: "active" };
}

function readTextFileIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf-8").trim();
  return content || null;
}

function listFilesRecursive(rootDir: string, relativePrefix = ""): string[] {
  if (!fs.existsSync(rootDir)) return [];

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextRelative = relativePrefix
      ? `${relativePrefix}/${entry.name}`
      : entry.name;
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(absolutePath, nextRelative));
      continue;
    }
    files.push(nextRelative);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function formatListSection(title: string, items: string[]): string {
  if (items.length === 0) {
    return `${title}\n- None`;
  }

  return `${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function listScratchUploadedAssets(workspaceDir: string): string[] {
  const candidates = [
    SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH,
    SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH,
  ];
  const collected: string[] = [];
  const seen = new Set<string>();

  for (const relativeRoot of candidates) {
    const rootDir = path.join(workspaceDir, relativeRoot);
    const files = listFilesRecursive(rootDir).map((file) => `${relativeRoot}/${file}`);
    for (const file of files) {
      if (seen.has(file)) continue;
      seen.add(file);
      collected.push(file);
    }
  }

  return collected.sort((a, b) => a.localeCompare(b));
}

function getPreferredScratchAssetRoot(workspaceDir: string): string {
  if (
    listFilesRecursive(
      path.join(workspaceDir, SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH),
    ).length > 0
  ) {
    return SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH;
  }

  if (
    listFilesRecursive(
      path.join(workspaceDir, SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH),
    ).length > 0
  ) {
    return SCRATCH_LEGACY_BRAND_ASSETS_RELATIVE_PATH;
  }

  return SCRATCH_ASTRO_BRAND_ASSETS_RELATIVE_PATH;
}

function buildStyleBlock(
  manifest: ScratchInitialGenerationManifest,
): string | null {
  const styleLine = manifest.stylePreset
    ? `Style preset: ${manifest.stylePreset}\n`
    : "";
  const paletteLine =
    manifest.stylePreset && manifest.stylePalette?.length
      ? `Color tokens (hex): ${manifest.stylePalette.join(", ")}\n`
      : "";
  const modeLine =
    manifest.stylePreset && manifest.styleMode
      ? `Color token usage: ${
          manifest.styleMode === "exact"
            ? "EXACT (please use exactly these colors)"
            : "REFERENCE (these colors are just for inspiration and don't need to exactly match)"
        }\n`
      : "";
  const themeLine = manifest.siteTheme
    ? `Theme preference: ${manifest.siteTheme.toUpperCase()}`
    : "";

  const block =
    styleLine || themeLine
      ? `${styleLine}${paletteLine}${modeLine}${themeLine}\n`
      : "";

  return block || null;
}

export function buildInitialGenerationTask(options: {
  workspaceDir: string;
  manifest: ScratchInitialGenerationManifest;
}): string {
  const scratchBrief = readTextFileIfExists(
    path.join(options.workspaceDir, "scratch_brief.txt"),
  );
  const imageDescriptions = readTextFileIfExists(
    path.join(options.workspaceDir, ".vivd", "image-files-description.txt"),
  );
  const referenceUrls =
    readTextFileIfExists(
      path.join(options.workspaceDir, SCRATCH_REFERENCE_FILES_RELATIVE_PATH, "urls.txt"),
    ) ??
    (options.manifest.referenceUrls?.join("\n") || null);
  const uploadedAssets = listScratchUploadedAssets(options.workspaceDir);
  const preferredAssetRoot = getPreferredScratchAssetRoot(options.workspaceDir);
  const referenceFiles = listFilesRecursive(
    path.join(options.workspaceDir, SCRATCH_REFERENCE_FILES_RELATIVE_PATH),
  )
    .filter((file) => file !== "urls.txt")
    .map((file) => `${SCRATCH_REFERENCE_FILES_RELATIVE_PATH}/${file}`);
  const styleBlock = buildStyleBlock(options.manifest);
  const fallbackBusinessBrief = [
    `Title: ${options.manifest.title}`,
    options.manifest.businessType
      ? `Business type: ${options.manifest.businessType}`
      : null,
    "",
    "Description:",
    options.manifest.description,
  ]
    .filter(Boolean)
    .join("\n");
  const businessBriefSection = scratchBrief
    ? `Business brief (from scratch_brief.txt):\n${scratchBrief}`
    : `Business brief:\n${fallbackBusinessBrief}`;

  return `Create a new, modern, beautiful, fully-fledged, high-converting website for the business described in the text below.
This is a "start from scratch" project: there is no source website screenshot, but you are starting from an existing Astro starter workspace.
You will also receive reference screenshots/images of designs the user likes. Use them as visual inspiration for layout, typography, spacing, components, and overall vibe.
Use the existing Astro + Tailwind setup and modern website best practices (layout, typography, spacing, subtle scroll-appear animations).
${
  options.manifest.stylePreset
    ? "Use the provided style preset and color tokens as direction."
    : ""
}${options.manifest.siteTheme ? ` Build a ${options.manifest.siteTheme} themed website.` : ""}
Create a complete, finished version 1 of the website in this run, not just a rough first draft.
Keep it production-ready: responsive, accessible, polished, and free of placeholder content.
If something important is missing, you may ask the user clarifying questions using the question tool, but otherwise make reasonable assumptions and finish the site.
Keep the project as Astro with the existing Tailwind setup. Do not replace the framework.
Use uploaded source assets from \`${preferredAssetRoot}/\` when relevant.
Treat \`src/content/media/\` as the canonical home for Astro-managed site assets. If the workspace still has legacy scratch assets under \`images/\`, you may reuse them, but prefer keeping final managed assets under \`src/content/media/\`.
Prefer Astro's \`Image\` component from \`astro:assets\` for almost all images. Use plain \`<img>\` only when \`Image\` is not practical.
Use \`public/\` only for passthrough files that intentionally need raw framework-public URLs, such as favicons, manifest icons, verification files, or other explicit compatibility cases. Do not default to moving the whole asset library into \`public/images/\`.
Treat \`references/\` as working material for inspiration and reconstruction, not as public site assets by default.
Maintain a clean structure in \`src/layouts\`, \`src/components\`, \`src/styles\`, and any additional content/data files you add.
Proactively update \`AGENTS.md\` so it stays current for this project, especially content locations and editing instructions.
Preserve a buildable project state when you finish.

${styleBlock ?? ""}${referenceUrls ? `Reference URLs:\n${referenceUrls}\n\n` : ""}${
  imageDescriptions
    ? `.vivd/image-files-description.txt:\n${imageDescriptions}\n\n`
    : ""
}${formatListSection("Uploaded source assets", uploadedAssets)}

${formatListSection("Reference files", referenceFiles)}

${businessBriefSection}
`;
}

async function updateBackendInitialGenerationStatus(options: {
  projectSlug: string;
  version: number;
  status:
    | "generating_initial_site"
    | "initial_generation_paused"
    | "completed"
    | "failed";
  sessionId?: string;
  errorMessage?: string;
}): Promise<void> {
  await callConnectedBackendMutation("studioApi.updateInitialGenerationStatus", {
    slug: options.projectSlug,
    version: options.version,
    status: options.status,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
  });
}

async function inspectExistingInitialGenerationSession(options: {
  workspaceDir: string;
  sessionId: string;
}): Promise<{
  messages: MonitoredSessionRecord[];
  sessionStatus:
    | { type: "idle" | "busy" | "done" | "retry" | "error"; message?: string }
    | null;
  hasPendingQuestion: boolean;
  outcome: {
    state: "active" | "completed" | "interrupted" | "failed";
    errorMessage?: string;
  };
  activityCount: number;
}> {
  const [statusMap, questions, messages] = await Promise.all([
    getSessionsStatus(options.workspaceDir),
    listQuestions(options.workspaceDir).catch(() => []),
    getSessionContent(options.sessionId, options.workspaceDir).catch(() => []),
  ]);

  const hasPendingQuestion = Array.isArray(questions)
    ? questions.some((question: { sessionID?: string; sessionId?: string }) => {
        const sessionId = question.sessionID ?? question.sessionId;
        return sessionId === options.sessionId;
      })
    : false;

  const normalizedMessages = Array.isArray(messages)
    ? (messages as MonitoredSessionRecord[])
    : [];
  const sessionStatus =
    (statusMap[options.sessionId] as
      | { type: "idle" | "busy" | "done" | "retry" | "error"; message?: string }
      | undefined) ?? null;
  const activityCount = countRecordedAssistantArtifacts(normalizedMessages);
  let outcome = deriveMonitoredSessionOutcome({
    sessionStatus,
    messages: normalizedMessages,
    hasPendingQuestion,
  });

  if (
    outcome.state === "active" &&
    shouldTreatZeroActivitySessionAsStaleForThisRuntime({
      sessionStatus,
      hasPendingQuestion,
      messages: normalizedMessages,
      activityCount,
    })
  ) {
    outcome = {
      state: "failed",
      errorMessage: normalizeInitialGenerationFailureMessage(null),
    };
  }

  return {
    messages: normalizedMessages,
    sessionStatus,
    hasPendingQuestion,
    outcome,
    activityCount,
  };
}

async function resetInitialGenerationForFreshStart(options: {
  projectSlug: string;
  version: number;
  workspaceDir: string;
  sessionId: string | null;
  errorMessage: string;
  deleteSessionRecord?: boolean;
}): Promise<void> {
  if (options.deleteSessionRecord && options.sessionId) {
    try {
      await deleteSession(options.sessionId, options.workspaceDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[InitialGeneration] Failed to delete stale session ${options.projectSlug}/v${options.version} (${options.sessionId}): ${message}`,
      );
    }
  }

  const manifest = readInitialGenerationManifest(options.workspaceDir);
  if (manifest.sessionId && options.sessionId && manifest.sessionId !== options.sessionId) {
    return;
  }

  persistInitialGenerationManifest({
    workspaceDir: options.workspaceDir,
    projectSlug: options.projectSlug,
    version: options.version,
    manifest: {
      ...manifest,
      state: "initial_generation_paused",
      sessionId: null,
      errorMessage: options.errorMessage,
      completedAt: null,
    },
  });

  try {
    await updateBackendInitialGenerationStatus({
      projectSlug: options.projectSlug,
      version: options.version,
      status: "initial_generation_paused",
      errorMessage: options.errorMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[InitialGeneration] Failed to report restart reset for ${options.projectSlug}/v${options.version}: ${message}`,
    );
  }
}

function startMonitor(options: {
  projectSlug: string;
  version: number;
  workspaceDir: string;
  sessionId: string;
}): void {
  if (monitoredSessions.has(options.sessionId)) {
    return;
  }

  let settled = false;
  let failureObserved = false;
  let probeInFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const stopPolling = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };

  const cleanupMonitor = () => {
    stopPolling();
    unsubscribe();
    if (monitoredSessions.get(options.sessionId) === cleanupMonitor) {
      monitoredSessions.delete(options.sessionId);
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void probeSession();
    }, MONITOR_POLL_MS);
    pollTimer.unref?.();
  };

  const finalizeCompletedSession = () => {
    if (settled) return;
    settled = true;
    stopPolling();
    void finalizeSessionCompletion(options).finally(() => {
      cleanupMonitor();
    });
  };

  const verifyCompletedSession = async () => {
    if (settled) return;

    try {
      const assessment = await inspectExistingInitialGenerationSession({
        workspaceDir: options.workspaceDir,
        sessionId: options.sessionId,
      });

      if (settled) return;

      if (assessment.outcome.state === "completed") {
        finalizeCompletedSession();
        return;
      }

      if (assessment.outcome.state === "interrupted") {
        reportSessionInterrupted(assessment.outcome.errorMessage);
        return;
      }

      if (assessment.outcome.state === "failed") {
        reportSessionFailed(assessment.outcome.errorMessage);
        return;
      }

      console.warn(
        `[InitialGeneration] Ignoring premature completion event for ${options.projectSlug}/v${options.version} (${options.sessionId}); persisted session is not terminal yet.`,
      );
      reportSessionResumed();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[InitialGeneration] Failed to verify completion for ${options.projectSlug}/v${options.version} (${options.sessionId}): ${message}`,
      );
    }
  };

  const reportSessionInterrupted = (message?: string) => {
    if (settled) return;
    failureObserved = true;
    stopPolling();
    void markSessionPaused({
      ...options,
      errorMessage: normalizeInitialGenerationFailureMessage(message ?? null),
    });
  };

  const reportSessionFailed = (message?: string) => {
    if (settled) return;
    failureObserved = true;
    stopPolling();
    void markSessionFailed({
      ...options,
      errorMessage: normalizeInitialGenerationFailureMessage(message ?? null),
    });
  };

  const reportSessionResumed = () => {
    if (settled || !failureObserved) return;
    failureObserved = false;
    void markSessionGenerating(options);
    startPolling();
  };

  const probeSession = async () => {
    if (settled || probeInFlight) {
      return;
    }

    probeInFlight = true;
    try {
      const [statusMap, questions, messages] = await Promise.all([
        getSessionsStatus(options.workspaceDir),
        listQuestions(options.workspaceDir).catch(() => []),
        getSessionContent(options.sessionId, options.workspaceDir).catch(() => []),
      ]);

      if (settled) {
        return;
      }

      const hasPendingQuestion = Array.isArray(questions)
        ? questions.some((question: { sessionID?: string; sessionId?: string }) => {
            const sessionId = question.sessionID ?? question.sessionId;
            return sessionId === options.sessionId;
          })
        : false;

      const outcome = deriveMonitoredSessionOutcome({
        sessionStatus:
          (statusMap[options.sessionId] as
            | { type: "idle" | "busy" | "done" | "retry" | "error"; message?: string }
            | undefined) ?? null,
        messages: Array.isArray(messages)
          ? (messages as MonitoredSessionRecord[])
          : [],
        hasPendingQuestion,
      });

      if (outcome.state === "completed") {
        finalizeCompletedSession();
        return;
      }

      if (outcome.state === "interrupted") {
        reportSessionInterrupted(outcome.errorMessage);
        return;
      }

      if (outcome.state === "failed") {
        reportSessionFailed(outcome.errorMessage);
        return;
      }

      if (failureObserved) {
        reportSessionResumed();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[InitialGeneration] Failed to probe session ${options.projectSlug}/v${options.version} (${options.sessionId}): ${message}`,
      );
    } finally {
      probeInFlight = false;
    }
  };

  const unsubscribe = agentEventEmitter.subscribeToSession(
    options.sessionId,
    (event) => {
      if (settled) return;

      if (event.type === "session.completed") {
        void verifyCompletedSession();
        return;
      }

      if (event.type === "session.error") {
        const errorData = event.data as {
          errorType?: string;
          message?: string;
        };
        if (errorData.errorType === "retry") {
          return;
        }

        reportSessionInterrupted(
          errorData.message || "Initial generation failed.",
        );
        return;
      }

      reportSessionResumed();
    },
  );

  startPolling();
  void probeSession();
  monitoredSessions.set(options.sessionId, cleanupMonitor);
}

async function markSessionFailed(options: {
  projectSlug: string;
  version: number;
  workspaceDir: string;
  sessionId: string;
  errorMessage: string;
}): Promise<void> {
  const key = `${options.workspaceDir}:${options.sessionId}:failed`;
  if (finalizationLocks.has(key)) {
    return await finalizationLocks.get(key);
  }

  const promise = (async () => {
    const manifest = readInitialGenerationManifest(options.workspaceDir);
    if (manifest.sessionId && manifest.sessionId !== options.sessionId) {
      return;
    }

    if (
      manifest.state === "failed" &&
      manifest.sessionId === options.sessionId &&
      (manifest.errorMessage ?? "") === options.errorMessage
    ) {
      return;
    }

    persistInitialGenerationManifest({
      workspaceDir: options.workspaceDir,
      projectSlug: options.projectSlug,
      version: options.version,
      manifest: {
        ...manifest,
        state: "failed",
        sessionId: options.sessionId,
        errorMessage: options.errorMessage,
        completedAt: new Date().toISOString(),
      },
    });

    try {
      await updateBackendInitialGenerationStatus({
        projectSlug: options.projectSlug,
        version: options.version,
        status: "failed",
        sessionId: options.sessionId,
        errorMessage: options.errorMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[InitialGeneration] Failed to report backend failure for ${options.projectSlug}/v${options.version}: ${message}`,
      );
    }
  })().finally(() => {
    finalizationLocks.delete(key);
  });

  finalizationLocks.set(key, promise);
  return await promise;
}

async function markSessionPaused(options: {
  projectSlug: string;
  version: number;
  workspaceDir: string;
  sessionId: string;
  errorMessage: string;
}): Promise<void> {
  const key = `${options.workspaceDir}:${options.sessionId}:paused`;
  if (finalizationLocks.has(key)) {
    return await finalizationLocks.get(key);
  }

  const promise = (async () => {
    const manifest = readInitialGenerationManifest(options.workspaceDir);
    if (manifest.sessionId && manifest.sessionId !== options.sessionId) {
      return;
    }

    if (
      manifest.state === "initial_generation_paused" &&
      manifest.sessionId === options.sessionId &&
      (manifest.errorMessage ?? "") === options.errorMessage
    ) {
      return;
    }

    persistInitialGenerationManifest({
      workspaceDir: options.workspaceDir,
      projectSlug: options.projectSlug,
      version: options.version,
      manifest: {
        ...manifest,
        state: "initial_generation_paused",
        sessionId: options.sessionId,
        errorMessage: options.errorMessage,
        completedAt: null,
      },
    });

    try {
      await updateBackendInitialGenerationStatus({
        projectSlug: options.projectSlug,
        version: options.version,
        status: "initial_generation_paused",
        sessionId: options.sessionId,
        errorMessage: options.errorMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[InitialGeneration] Failed to report backend paused state for ${options.projectSlug}/v${options.version}: ${message}`,
      );
    }
  })().finally(() => {
    finalizationLocks.delete(key);
  });

  finalizationLocks.set(key, promise);
  return await promise;
}

async function markSessionGenerating(options: {
  projectSlug: string;
  version: number;
  workspaceDir: string;
  sessionId: string;
}): Promise<void> {
  const manifest = readInitialGenerationManifest(options.workspaceDir);
  if (manifest.sessionId && manifest.sessionId !== options.sessionId) {
    return;
  }

  if (
    manifest.state === "generating_initial_site" &&
    manifest.sessionId === options.sessionId &&
    !manifest.errorMessage
  ) {
    return;
  }

  persistInitialGenerationManifest({
    workspaceDir: options.workspaceDir,
    projectSlug: options.projectSlug,
    version: options.version,
    manifest: {
      ...manifest,
      state: "generating_initial_site",
      sessionId: options.sessionId,
      startedAt: manifest.startedAt ?? new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
    },
  });

  try {
    await updateBackendInitialGenerationStatus({
      projectSlug: options.projectSlug,
      version: options.version,
      status: "generating_initial_site",
      sessionId: options.sessionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[InitialGeneration] Failed to report resumed generating state for ${options.projectSlug}/v${options.version}: ${message}`,
    );
  }
}

async function finalizeSessionCompletion(options: {
  projectSlug: string;
  version: number;
  workspaceDir: string;
  sessionId: string;
}): Promise<void> {
  const key = `${options.workspaceDir}:${options.sessionId}:completed`;
  if (finalizationLocks.has(key)) {
    return await finalizationLocks.get(key);
  }

  const promise = (async () => {
    const manifest = readInitialGenerationManifest(options.workspaceDir);
    if (manifest.sessionId && manifest.sessionId !== options.sessionId) {
      return;
    }
    if (manifest.state === "completed") {
      return;
    }

    try {
      let commitHash: string | undefined;
      try {
        const snapshot = await saveInitialGenerationSnapshot(options.workspaceDir);
        commitHash = snapshot.commitHash ?? undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[InitialGeneration] Failed to save completion snapshot for ${options.projectSlug}/v${options.version}: ${message}`,
        );
      }

      await syncSourceToBucket({
        projectDir: options.workspaceDir,
        slug: options.projectSlug,
        version: options.version,
        commitHash,
      });

      const projectType = detectProjectType(options.workspaceDir);
      if (projectType.framework === "astro") {
        await buildAndUploadPreview({
          projectDir: options.workspaceDir,
          slug: options.projectSlug,
          version: options.version,
          commitHash,
        });
        thumbnailGenerationReporter.request(
          options.projectSlug,
          options.version,
        );
      } else {
        thumbnailGenerationReporter.request(
          options.projectSlug,
          options.version,
        );
      }

      persistInitialGenerationManifest({
        workspaceDir: options.workspaceDir,
        projectSlug: options.projectSlug,
        version: options.version,
        manifest: {
          ...manifest,
          state: "completed",
          sessionId: options.sessionId,
          errorMessage: null,
          completedAt: new Date().toISOString(),
        },
      });

      await updateBackendInitialGenerationStatus({
        projectSlug: options.projectSlug,
        version: options.version,
        status: "completed",
        sessionId: options.sessionId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Initial generation post-processing failed.";
      await markSessionFailed({
        ...options,
        errorMessage: message,
      });
    }
  })().finally(() => {
    finalizationLocks.delete(key);
  });

  finalizationLocks.set(key, promise);
  return await promise;
}

async function startInitialGenerationInternal(
  options: StartInitialGenerationOptions,
): Promise<StartInitialGenerationResult> {
  let manifest = await readInitialGenerationManifestWithRetry(
    options.workspaceDir,
  );
  const existingSessionId = manifest.sessionId?.trim() || null;
  let resetForFreshStart = false;

  if (existingSessionId) {
    const sessions = await listSessions(options.workspaceDir);
    const existingSession = sessions.find(
      (session: { id?: string }) => session.id === existingSessionId,
    );

    if (existingSession) {
      const assessment = await inspectExistingInitialGenerationSession({
        workspaceDir: options.workspaceDir,
        sessionId: existingSessionId,
      });

      if (
        agentEventEmitter.isSessionCompleted(existingSessionId) ||
        assessment.outcome.state === "completed"
      ) {
        await finalizeSessionCompletion({
          projectSlug: options.projectSlug,
          version: options.version,
          workspaceDir: options.workspaceDir,
          sessionId: existingSessionId,
        });

        return {
          sessionId: existingSessionId,
          reused: true,
          status: "completed",
        };
      }

      if (assessment.outcome.state === "interrupted") {
        const errorMessage =
          assessment.outcome.errorMessage ??
          normalizeInitialGenerationFailureMessage(null);

        await markSessionPaused({
          projectSlug: options.projectSlug,
          version: options.version,
          workspaceDir: options.workspaceDir,
          sessionId: existingSessionId,
          errorMessage,
        });

        startMonitor({
          projectSlug: options.projectSlug,
          version: options.version,
          workspaceDir: options.workspaceDir,
          sessionId: existingSessionId,
        });

        return {
          sessionId: existingSessionId,
          reused: true,
          status: "initial_generation_paused",
        };
      }

      if (assessment.outcome.state === "failed") {
        const errorMessage =
          assessment.outcome.errorMessage ??
          normalizeInitialGenerationFailureMessage(null);

        await resetInitialGenerationForFreshStart({
          projectSlug: options.projectSlug,
          version: options.version,
          workspaceDir: options.workspaceDir,
          sessionId: existingSessionId,
          errorMessage,
          deleteSessionRecord: assessment.activityCount === 0,
        });
        resetForFreshStart = true;
      } else {
        const nextState = "generating_initial_site";

        persistInitialGenerationManifest({
          workspaceDir: options.workspaceDir,
          projectSlug: options.projectSlug,
          version: options.version,
          manifest: {
            ...manifest,
            state: nextState,
            errorMessage: null,
          },
        });
        try {
          await updateBackendInitialGenerationStatus({
            projectSlug: options.projectSlug,
            version: options.version,
            status: "generating_initial_site",
            sessionId: existingSessionId,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[InitialGeneration] Failed to report resumed status for ${options.projectSlug}/v${options.version}: ${message}`,
          );
        }

        startMonitor({
          projectSlug: options.projectSlug,
          version: options.version,
          workspaceDir: options.workspaceDir,
          sessionId: existingSessionId,
        });

        return {
          sessionId: existingSessionId,
          reused: true,
          status: nextState,
        };
      }
    } else {
      await resetInitialGenerationForFreshStart({
        projectSlug: options.projectSlug,
        version: options.version,
        workspaceDir: options.workspaceDir,
        sessionId: existingSessionId,
        errorMessage: normalizeInitialGenerationFailureMessage(null),
      });
      resetForFreshStart = true;
    }
  }

  if (resetForFreshStart) {
    manifest = readInitialGenerationManifest(options.workspaceDir);
  }

  const task = buildInitialGenerationTask({
    workspaceDir: options.workspaceDir,
    manifest,
  });

  try {
    const result = await runTask(
      task,
      options.workspaceDir,
      undefined,
      options.model ?? manifest.model ?? undefined,
      {
        sessionStartSystemPromptSuffix:
          INITIAL_GENERATION_SESSION_START_SYSTEM_PROMPT_SUFFIX,
      },
    );

    const sessionId = result.sessionId;
    persistInitialGenerationManifest({
      workspaceDir: options.workspaceDir,
      projectSlug: options.projectSlug,
      version: options.version,
      manifest: {
        ...manifest,
        state: "generating_initial_site",
        sessionId,
        startedAt: manifest.startedAt ?? new Date().toISOString(),
        completedAt: null,
        errorMessage: null,
      },
    });

    await updateBackendInitialGenerationStatus({
      projectSlug: options.projectSlug,
      version: options.version,
      status: "generating_initial_site",
      sessionId,
    });

    startMonitor({
      projectSlug: options.projectSlug,
      version: options.version,
      workspaceDir: options.workspaceDir,
      sessionId,
    });

    return {
      sessionId,
      reused: false,
      status: "generating_initial_site",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start initial generation.";
    persistInitialGenerationManifest({
      workspaceDir: options.workspaceDir,
      projectSlug: options.projectSlug,
      version: options.version,
      manifest: {
        ...manifest,
        state: "failed",
        errorMessage: message,
        completedAt: new Date().toISOString(),
        sessionId: null,
      },
    });

    try {
      await updateBackendInitialGenerationStatus({
        projectSlug: options.projectSlug,
        version: options.version,
        status: "failed",
        errorMessage: message,
      });
    } catch (reportError) {
      const reportMessage =
        reportError instanceof Error ? reportError.message : String(reportError);
      console.warn(
        `[InitialGeneration] Failed to report startup failure for ${options.projectSlug}/v${options.version}: ${reportMessage}`,
      );
    }

    throw error;
  }
}

class InitialGenerationService {
  async resolveInitialGenerationSessionForHandoff(
    options: StartInitialGenerationOptions,
  ): Promise<string | null> {
    const manifest = await readInitialGenerationManifestWithRetry(
      options.workspaceDir,
    );
    const existingSessionId = manifest.sessionId?.trim() || null;
    if (!existingSessionId) {
      return null;
    }

    const sessions = await listSessions(options.workspaceDir);
    const existingSession = sessions.find(
      (session: { id?: string }) => session.id === existingSessionId,
    );

    if (!existingSession) {
      await resetInitialGenerationForFreshStart({
        projectSlug: options.projectSlug,
        version: options.version,
        workspaceDir: options.workspaceDir,
        sessionId: existingSessionId,
        errorMessage: normalizeInitialGenerationFailureMessage(null),
      });
      return null;
    }

    const assessment = await inspectExistingInitialGenerationSession({
      workspaceDir: options.workspaceDir,
      sessionId: existingSessionId,
    });

    if (
      agentEventEmitter.isSessionCompleted(existingSessionId) ||
      assessment.outcome.state === "completed"
    ) {
      await finalizeSessionCompletion({
        projectSlug: options.projectSlug,
        version: options.version,
        workspaceDir: options.workspaceDir,
        sessionId: existingSessionId,
      });
      return existingSessionId;
    }

    if (
      assessment.outcome.state === "active" ||
      assessment.outcome.state === "interrupted"
    ) {
      if (assessment.outcome.state === "interrupted") {
        await markSessionPaused({
          projectSlug: options.projectSlug,
          version: options.version,
          workspaceDir: options.workspaceDir,
          sessionId: existingSessionId,
          errorMessage:
            assessment.outcome.errorMessage ??
            normalizeInitialGenerationFailureMessage(null),
        });
      }

      startMonitor({
        projectSlug: options.projectSlug,
        version: options.version,
        workspaceDir: options.workspaceDir,
        sessionId: existingSessionId,
      });
      return existingSessionId;
    }

    const errorMessage =
      assessment.outcome.errorMessage ??
      normalizeInitialGenerationFailureMessage(null);

    await resetInitialGenerationForFreshStart({
      projectSlug: options.projectSlug,
      version: options.version,
      workspaceDir: options.workspaceDir,
      sessionId: existingSessionId,
      errorMessage,
      deleteSessionRecord: assessment.activityCount === 0,
    });
    return null;
  }

  async startInitialGeneration(
    options: StartInitialGenerationOptions,
  ): Promise<StartInitialGenerationResult> {
    const lockKey = `${options.workspaceDir}:${options.projectSlug}:v${options.version}`;
    const inflight = startLocks.get(lockKey);
    if (inflight) {
      return await inflight;
    }

    const promise = startInitialGenerationInternal(options).finally(() => {
      startLocks.delete(lockKey);
    });
    startLocks.set(lockKey, promise);
    return await promise;
  }
}

export const initialGenerationService = new InitialGenerationService();
