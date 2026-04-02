import fs from "node:fs";
import path from "node:path";
import {
  isConnectedMode,
  INITIAL_GENERATION_MANIFEST_RELATIVE_PATH,
  type InitialGenerationState,
  type ScratchInitialGenerationManifest,
} from "@vivd/shared";
import {
  agentEventEmitter,
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
import { requestConnectedArtifactBuild } from "../sync/ConnectedArtifactBuildService.js";
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
};

function deriveMonitoredSessionOutcome(options: {
  sessionStatus:
    | { type: "idle" | "busy" | "done" | "retry" | "error"; message?: string }
    | null;
  messages: MonitoredSessionRecord[];
  hasPendingQuestion: boolean;
  now?: number;
}): { state: "active" | "completed" | "failed"; errorMessage?: string } {
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
      state: "failed",
      errorMessage: normalizeInitialGenerationFailureMessage(assistantError),
    };
  }

  if (sessionStatusType === "error") {
    return {
      state: "failed",
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
    latestActivityAt != null &&
    (options.now ?? Date.now()) - latestActivityAt >= TERMINAL_IDLE_GRACE_MS
  ) {
    return {
      state: "failed",
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
    readTextFileIfExists(path.join(options.workspaceDir, "references", "urls.txt")) ??
    (options.manifest.referenceUrls?.join("\n") || null);
  const uploadedAssets = listFilesRecursive(path.join(options.workspaceDir, "images")).map(
    (file) => `images/${file}`,
  );
  const referenceFiles = listFilesRecursive(
    path.join(options.workspaceDir, "references"),
  )
    .filter((file) => file !== "urls.txt")
    .map((file) => `references/${file}`);
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
Use uploaded source assets from \`images/\` when relevant. If a file should be publicly served by Astro, copy or move the final chosen asset into \`public/images/\` and update the site code accordingly.
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
  status: "generating_initial_site" | "completed" | "failed";
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

  const reportSessionFailure = (message?: string) => {
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

      if (outcome.state === "failed") {
        reportSessionFailure(outcome.errorMessage);
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
        finalizeCompletedSession();
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

        reportSessionFailure(errorData.message || "Initial generation failed.");
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

    writeInitialGenerationManifest(options.workspaceDir, {
      ...manifest,
      state: "failed",
      sessionId: options.sessionId,
      errorMessage: options.errorMessage,
      completedAt: new Date().toISOString(),
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

  writeInitialGenerationManifest(options.workspaceDir, {
    ...manifest,
    state: "generating_initial_site",
    sessionId: options.sessionId,
    startedAt: manifest.startedAt ?? new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
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
        try {
          const requested = await requestConnectedArtifactBuild({
            slug: options.projectSlug,
            version: options.version,
            kind: "preview",
            commitHash,
          });
          if (requested.requested) {
            if (requested.status === "ready") {
              thumbnailGenerationReporter.request(
                options.projectSlug,
                options.version,
              );
            }
          } else {
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
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[InitialGeneration] Connected preview build request failed, falling back to local build for ${options.projectSlug}/v${options.version}: ${message}`,
          );
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
        }
      } else {
        thumbnailGenerationReporter.request(
          options.projectSlug,
          options.version,
        );
      }

      writeInitialGenerationManifest(options.workspaceDir, {
        ...manifest,
        state: "completed",
        sessionId: options.sessionId,
        errorMessage: null,
        completedAt: new Date().toISOString(),
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
  const manifest = readInitialGenerationManifest(options.workspaceDir);
  const existingSessionId = manifest.sessionId?.trim() || null;

  if (existingSessionId) {
    const sessions = await listSessions(options.workspaceDir);
    const existingSession = sessions.find(
      (session: { id?: string }) => session.id === existingSessionId,
    );

    if (existingSession) {
      const statuses = await getSessionsStatus(options.workspaceDir);
      const sessionStatus = statuses[existingSessionId]?.type ?? "idle";

      if (agentEventEmitter.isSessionCompleted(existingSessionId)) {
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

      const nextState =
        manifest.state === "completed" || manifest.state === "failed"
          ? manifest.state
          : "generating_initial_site";

      if (nextState === "generating_initial_site") {
        writeInitialGenerationManifest(options.workspaceDir, {
          ...manifest,
          state: nextState,
          errorMessage: null,
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
      }

      if (sessionStatus === "busy" || sessionStatus === "retry") {
        startMonitor({
          projectSlug: options.projectSlug,
          version: options.version,
          workspaceDir: options.workspaceDir,
          sessionId: existingSessionId,
        });
      }

      return {
        sessionId: existingSessionId,
        reused: true,
        status: nextState,
      };
    }
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
      options.model,
      {
        // The scratch initial-generation prompt already carries the full
        // project-building instruction set. Skipping the extra Vivd
        // session-start prompt keeps this path closer to upstream OpenCode
        // and avoids doubling the prompt surface on the most fragile first run.
        skipSessionStartSystemPrompt: true,
      },
    );

    const sessionId = result.sessionId;
    writeInitialGenerationManifest(options.workspaceDir, {
      ...manifest,
      state: "generating_initial_site",
      sessionId,
      startedAt: manifest.startedAt ?? new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
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
    writeInitialGenerationManifest(options.workspaceDir, {
      ...manifest,
      state: "failed",
      errorMessage: message,
      completedAt: new Date().toISOString(),
      sessionId: null,
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
