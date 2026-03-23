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
  getSessionsStatus,
  listSessions,
  runTask,
  type ModelSelection,
} from "../../opencode/index.js";
import { detectProjectType } from "../project/projectType.js";
import {
  buildAndUploadPreview,
  syncSourceToBucket,
} from "../sync/ArtifactSyncService.js";
import { thumbnailGenerationReporter } from "../reporting/ThumbnailGenerationReporter.js";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
  type ConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

const startLocks = new Map<string, Promise<StartInitialGenerationResult>>();
const monitoredSessions = new Map<string, () => void>();
const finalizationLocks = new Map<string, Promise<void>>();

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
  errorMessage?: string;
}): Promise<void> {
  await callConnectedBackendMutation("studioApi.updateInitialGenerationStatus", {
    slug: options.projectSlug,
    version: options.version,
    status: options.status,
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

  const unsubscribe = agentEventEmitter.subscribeToSession(
    options.sessionId,
    (event) => {
      if (settled) return;

      if (event.type === "session.completed") {
        settled = true;
        void finalizeSessionCompletion(options).finally(() => {
          const activeUnsubscribe = monitoredSessions.get(options.sessionId);
          activeUnsubscribe?.();
          monitoredSessions.delete(options.sessionId);
        });
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

        settled = true;
        void markSessionFailed({
          ...options,
          errorMessage: errorData.message || "Initial generation failed.",
        }).finally(() => {
          const activeUnsubscribe = monitoredSessions.get(options.sessionId);
          activeUnsubscribe?.();
          monitoredSessions.delete(options.sessionId);
        });
      }
    },
  );

  monitoredSessions.set(options.sessionId, unsubscribe);
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
      await syncSourceToBucket({
        projectDir: options.workspaceDir,
        slug: options.projectSlug,
        version: options.version,
      });

      const projectType = detectProjectType(options.workspaceDir);
      if (projectType.framework === "astro") {
        await buildAndUploadPreview({
          projectDir: options.workspaceDir,
          slug: options.projectSlug,
          version: options.version,
        });
      }

      thumbnailGenerationReporter.request(
        options.projectSlug,
        options.version,
      );

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
