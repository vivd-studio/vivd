import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { useEvents, type ToolCall } from "./useEvents.js";
import {
  agentEventEmitter,
  createAgentEvent,
  type ReasoningDeltaData,
  type MessageDeltaData,
  type ToolStartedData,
  type ToolCompletedData,
  type ToolErrorData,
  type SessionCompletedData,
  type ThinkingStartedData,
  type SessionErrorData,
  type UsageUpdatedData,
  type SessionStatus,
} from "./eventEmitter.js";
import { serverManager } from "./serverManager.js";
import { usageReporter } from "../services/reporting/UsageReporter.js";
import { agentLeaseReporter } from "../services/reporting/AgentLeaseReporter.js";
import { requestBucketSyncAfterAgentTask } from "../services/sync/AgentTaskSyncService.js";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService.js";
import { workspaceEventPump } from "./events/workspaceEventPump.js";
import { isStudioSoftContextLimitReached } from "../../shared/opencodeContextPolicy.js";
import { getStudioOpencodeSoftContextLimitTokens } from "../config.js";
import {
  resolveOpencodeSnapshotGitState,
  snapshotGitDirHasObject,
} from "./snapshotGitDirRepair.js";

import type { ModelSelection } from "./modelConfig.js";
import { getDefaultModel } from "./modelConfig.js";

export { useEvents };
export { agentEventEmitter } from "./eventEmitter.js";
export type { AgentEvent, AgentEventType } from "./eventEmitter.js";
export { serverManager } from "./serverManager.js";
export { getAvailableModels, getAvailableModelsWithMetadata } from "./modelConfig.js";
export type { ModelTier, ModelSelection } from "./modelConfig.js";

const sessionTitleCache = new Map<
  string,
  { title: string | undefined; fetchedAt: number }
>();

const DEFAULT_TITLE_TTL_MS = 30_000;
const PENDING_TITLE_TTL_MS = 5_000;
type SessionMessageRecord = {
  info?: Record<string, unknown>;
  parts?: Array<Record<string, unknown>>;
};

type LatestAssistantTerminalState = {
  hasAssistant: boolean;
  isTerminal: boolean;
  reason:
    | "no_assistant"
    | "assistant_error"
    | "assistant_completed"
    | "assistant_finish"
    | "assistant_unfinished";
};

type RevertPatchPartRecord = {
  type?: unknown;
  files?: unknown;
  hash?: unknown;
};

type RevertPatchHistory = {
  files: string[];
  hashes: string[];
};

function isPlaceholderTitle(title: string | undefined): boolean {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  return t === "new session" || t.startsWith("new session");
}

async function getSessionTitle(
  client: OpencodeClient,
  cwd: string,
  sessionId: string,
): Promise<string | undefined> {
  const cached = sessionTitleCache.get(sessionId);
  if (cached) {
    const ttl = isPlaceholderTitle(cached.title)
      ? PENDING_TITLE_TTL_MS
      : DEFAULT_TITLE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.title;
    }
  }

  try {
    const result = await client.session.list({ directory: cwd });
    if (result.error) return undefined;
    const sessions = (result.data || []) as any[];
    const match = sessions.find((s) => s?.id === sessionId);
    const title = typeof match?.title === "string" ? match.title : undefined;
    sessionTitleCache.set(sessionId, { title, fetchedAt: Date.now() });
    return title;
  } catch {
    return undefined;
  }
}

function readSessionString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function readSessionNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

type DetailedSessionFileDiff = {
  file: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
  patch?: string;
  before?: string;
  after?: string;
};

function normalizeDetailedSessionDiffs(value: unknown): DetailedSessionFileDiff[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): DetailedSessionFileDiff | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const file = typeof (item as any).file === "string" ? (item as any).file : "";
      if (!file) {
        return null;
      }

      return {
        file,
        additions: Number((item as any).additions) || 0,
        deletions: Number((item as any).deletions) || 0,
        ...(typeof (item as any).status === "string"
          ? { status: (item as any).status as "added" | "deleted" | "modified" }
          : {}),
        ...(typeof (item as any).patch === "string"
          ? { patch: (item as any).patch }
          : {}),
        ...(typeof (item as any).before === "string"
          ? { before: (item as any).before }
          : {}),
        ...(typeof (item as any).after === "string"
          ? { after: (item as any).after }
          : {}),
      };
    })
    .filter((item): item is DetailedSessionFileDiff => Boolean(item));
}

function getPatchHistoryForMessageRevert(
  messages: SessionMessageRecord[],
  userMessageId: string,
): RevertPatchHistory {
  const files = new Set<string>();
  const hashes = new Set<string>();
  let collect = false;

  for (const message of messages) {
    const messageId = readSessionString(message?.info?.id);
    if (!collect) {
      if (messageId !== userMessageId) {
        continue;
      }
      collect = true;
      continue;
    }

    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const part of parts as RevertPatchPartRecord[]) {
      if (part?.type !== "patch") {
        continue;
      }

      const patchFiles = Array.isArray(part.files) ? part.files : [];
      for (const file of patchFiles) {
        if (typeof file === "string" && file.trim().length > 0) {
          files.add(file);
        }
      }

      if (typeof part.hash === "string" && part.hash.trim().length > 0) {
        hashes.add(part.hash);
      }
    }
  }

  return {
    files: [...files],
    hashes: [...hashes],
  };
}

function normalizeUnifiedDiffPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/dev/null") {
    return null;
  }

  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }

  return trimmed;
}

function getTrackedFilesFromUnifiedDiff(diffText: string | undefined): string[] {
  if (!diffText) {
    return [];
  }

  const files = new Set<string>();
  for (const line of diffText.split(/\r?\n/)) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      const file = normalizeUnifiedDiffPath(diffMatch[2] ?? diffMatch[1] ?? "");
      if (file) {
        files.add(file);
      }
      continue;
    }

    const plusMatch = line.match(/^\+\+\+ (.+)$/);
    if (plusMatch) {
      const file = normalizeUnifiedDiffPath(plusMatch[1] ?? "");
      if (file) {
        files.add(file);
      }
      continue;
    }

    const minusMatch = line.match(/^--- (.+)$/);
    if (minusMatch) {
      const file = normalizeUnifiedDiffPath(minusMatch[1] ?? "");
      if (file) {
        files.add(file);
      }
    }
  }

  return [...files];
}

function resolveTrackedFilePath(worktree: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(worktree, file);
}

async function fingerprintTrackedFile(
  worktree: string,
  file: string,
): Promise<string> {
  const target = resolveTrackedFilePath(worktree, file);
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      return `symlink:${await fs.readlink(target)}`;
    }
    if (!stat.isFile()) {
      return `type:${stat.mode.toString(8)}`;
    }

    const content = await fs.readFile(target);
    return `file:${crypto.createHash("sha1").update(content).digest("hex")}`;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "unknown";
    return `missing:${code}`;
  }
}

async function captureTrackedFileFingerprints(
  worktree: string,
  files: string[],
): Promise<Map<string, string>> {
  const pairs = await Promise.all(
    files.map(async (file) => [file, await fingerprintTrackedFile(worktree, file)] as const),
  );
  return new Map(pairs);
}

function didTrackedFileFingerprintsChange(
  before: Map<string, string>,
  after: Map<string, string>,
): boolean {
  for (const [file, fingerprint] of before) {
    if (after.get(file) !== fingerprint) {
      return true;
    }
  }
  return false;
}

function getSessionTokenTotal(
  info: Record<string, unknown> | undefined,
): number | undefined {
  if (!info || typeof info !== "object") {
    return undefined;
  }

  const tokens = info.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== "object") {
    return undefined;
  }

  const explicitTotal = readSessionNumber(tokens.total);
  if (explicitTotal && explicitTotal > 0) {
    return explicitTotal;
  }

  const input = readSessionNumber(tokens.input) ?? 0;
  const output = readSessionNumber(tokens.output) ?? 0;
  const reasoning = readSessionNumber(tokens.reasoning) ?? 0;
  const cache = (tokens.cache as Record<string, unknown> | undefined) ?? {};
  const cacheRead = readSessionNumber(cache.read) ?? 0;
  const cacheWrite = readSessionNumber(cache.write) ?? 0;
  const total = input + output + reasoning + cacheRead + cacheWrite;

  return total > 0 ? total : undefined;
}

function getLatestAssistantContextSnapshot(messages: SessionMessageRecord[]): {
  totalTokens: number;
  provider?: string;
  modelId?: string;
  summary: boolean;
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const info = message?.info;
    if (info?.role !== "assistant") {
      continue;
    }

    const totalTokens = getSessionTokenTotal(info);
    if (!totalTokens) {
      continue;
    }

    return {
      totalTokens,
      provider: readSessionString(
        info.providerID,
        info.providerId,
        (info.model as Record<string, unknown> | undefined)?.providerID,
        (info.model as Record<string, unknown> | undefined)?.providerId,
      ),
      modelId: readSessionString(
        info.modelID,
        info.modelId,
        (info.model as Record<string, unknown> | undefined)?.modelID,
        (info.model as Record<string, unknown> | undefined)?.modelId,
      ),
      summary: info.summary === true,
    };
  }

  return null;
}

function resolveCompactionModelSelection(
  preferredModel: ModelSelection | undefined,
  latestAssistant: {
    provider?: string;
    modelId?: string;
  } | null,
): ModelSelection | null {
  if (preferredModel) {
    return preferredModel;
  }

  if (latestAssistant?.provider && latestAssistant.modelId) {
    return {
      provider: latestAssistant.provider,
      modelId: latestAssistant.modelId,
    };
  }

  return getDefaultModel();
}

function getLatestAssistantTerminalState(
  messages: SessionMessageRecord[],
): LatestAssistantTerminalState {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role !== "assistant") {
      continue;
    }

    if (info.error != null) {
      return {
        hasAssistant: true,
        isTerminal: true,
        reason: "assistant_error",
      };
    }

    const completedAt = readSessionNumber(
      (info.time as Record<string, unknown> | undefined)?.completed,
    );
    if (typeof completedAt === "number") {
      return {
        hasAssistant: true,
        isTerminal: true,
        reason: "assistant_completed",
      };
    }

    const finish = readSessionString(info.finish);
    if (finish && !["tool-calls", "unknown"].includes(finish)) {
      return {
        hasAssistant: true,
        isTerminal: true,
        reason: "assistant_finish",
      };
    }

    return {
      hasAssistant: true,
      isTerminal: false,
      reason: "assistant_unfinished",
    };
  }

  return {
    hasAssistant: false,
    isTerminal: false,
    reason: "no_assistant",
  };
}

async function inspectLatestAssistantTerminalState(options: {
  client: OpencodeClient;
  directory: string;
  sessionId: string;
}): Promise<LatestAssistantTerminalState> {
  try {
    const result = await options.client.session.messages({
      sessionID: options.sessionId,
      directory: options.directory,
    });
    if (result.error) {
      console.warn(
        `[OpenCode] Failed to inspect session=${options.sessionId} for terminal completion: ${JSON.stringify(result.error)}`,
      );
      return {
        hasAssistant: false,
        isTerminal: false,
        reason: "no_assistant",
      };
    }

    const messages = Array.isArray(result.data)
      ? (result.data as SessionMessageRecord[])
      : [];
    return getLatestAssistantTerminalState(messages);
  } catch (error) {
    console.warn(
      `[OpenCode] Failed to inspect session=${options.sessionId} for terminal completion: ${toErrorMessage(error, "Unknown session inspection failure")}`,
    );
    return {
      hasAssistant: false,
      isTerminal: false,
      reason: "no_assistant",
    };
  }
}

async function maybeSoftCompactSession(options: {
  client: OpencodeClient;
  directory: string;
  sessionId: string;
  modelSelection?: ModelSelection;
}): Promise<boolean> {
  try {
    const result = await options.client.session.messages({
      sessionID: options.sessionId,
      directory: options.directory,
    });
    if (result.error) {
      console.warn(
        `[OpenCode] Failed to inspect session=${options.sessionId} for soft compaction: ${JSON.stringify(result.error)}`,
      );
      return false;
    }

    const messages = Array.isArray(result.data)
      ? (result.data as SessionMessageRecord[])
      : [];
    const latestAssistant = getLatestAssistantContextSnapshot(messages);
    if (!latestAssistant || latestAssistant.summary) {
      return false;
    }

    const softContextLimitTokens = getStudioOpencodeSoftContextLimitTokens();
    if (
      !isStudioSoftContextLimitReached({
        totalTokens: latestAssistant.totalTokens,
        softLimit: softContextLimitTokens,
      })
    ) {
      return false;
    }

    const compactionModel = resolveCompactionModelSelection(
      options.modelSelection,
      latestAssistant,
    );
    if (!compactionModel) {
      console.warn(
        `[OpenCode] Skipping soft compaction for session=${options.sessionId}; no model is configured.`,
      );
      return false;
    }

    console.log(
      `[OpenCode] Auto-compacting session=${options.sessionId} totalTokens=${latestAssistant.totalTokens} threshold=${softContextLimitTokens} model=${compactionModel.provider}/${compactionModel.modelId}`,
    );
    const summarizeResult = await options.client.session.summarize({
      sessionID: options.sessionId,
      directory: options.directory,
      providerID: compactionModel.provider,
      modelID: compactionModel.modelId,
      auto: true,
    });
    if (summarizeResult.error) {
      console.warn(
        `[OpenCode] Soft compaction failed for session=${options.sessionId}: ${JSON.stringify(summarizeResult.error)}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      `[OpenCode] Soft compaction failed for session=${options.sessionId}: ${toErrorMessage(error, "Unknown compaction failure")}`,
    );
    return false;
  }
}

export async function runTask(
  task: string,
  cwd: string,
  sessionId?: string,
  model?: ModelSelection,
  options?: {
    tools?: Record<string, boolean>;
    skipSessionStartSystemPrompt?: boolean;
  },
): Promise<{ sessionId: string }> {
  console.log(
    `[OpenCode] Starting task in ${cwd}: "${task}" (Session: ${
      sessionId || "New"
    })`,
  );

  const { client, directory } = await serverManager.getClientAndDirectory(cwd);
  await workspaceEventPump.retainTemporarily(directory);

  const currentSessionId = await getOrCreateSession(client, directory, sessionId);
  await maybeSoftCompactSession({
    client,
    directory,
    sessionId: currentSessionId,
    modelSelection: model,
  });
  const isNewSession =
    !sessionId || !(await sessionHasMessages(client, directory, currentSessionId));
  const leaseRunId = crypto.randomUUID();
  const connectedProjectSlug = (process.env.VIVD_PROJECT_SLUG || "").trim();
  const connectedProjectVersion = Number.parseInt(
    process.env.VIVD_PROJECT_VERSION || "",
    10,
  );
  if (
    connectedProjectSlug &&
    Number.isFinite(connectedProjectVersion) &&
    connectedProjectVersion > 0
  ) {
    agentLeaseReporter.startRun({
      runId: leaseRunId,
      sessionId: currentSessionId,
      projectSlug: connectedProjectSlug,
      version: connectedProjectVersion,
    });
  }
  agentEventEmitter.setSessionStatus(currentSessionId, { type: "busy" });
  let completionHandled = false;
  let idleFinalizationInFlight = false;
  let bucketSyncRequestedForCurrentActivity = false;

  const markSessionActivity = () => {
    bucketSyncRequestedForCurrentActivity = false;
  };

  const requestBucketSyncForSettledActivity = () => {
    if (bucketSyncRequestedForCurrentActivity) return;
    bucketSyncRequestedForCurrentActivity = true;
    requestBucketSyncAfterAgentTask({
      sessionId: currentSessionId,
      projectDir: directory,
    });
  };

  const finalizeSessionRun = () => {
    if (completionHandled) return;
    completionHandled = true;
    agentLeaseReporter.finishRun(leaseRunId);

    agentEventEmitter.emitSessionEvent(
      currentSessionId,
      createAgentEvent(currentSessionId, "session.completed", {
        kind: "session.completed",
      } as SessionCompletedData),
    );
    void (async () => {
      const sessionTitle = await getSessionTitle(client, directory, currentSessionId);
      if (sessionTitle) {
        await usageReporter.updateSessionTitle(
          currentSessionId,
          sessionTitle,
          process.env.VIVD_PROJECT_SLUG || cwd,
        );
      }
    })();
    requestBucketSyncForSettledActivity();
    stop();
  };

  const { start, stop } = useEvents(client, {
    sessionId: currentSessionId,
    onStartThinking: () => {
      markSessionActivity();
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "thinking.started", {
          kind: "thinking.started",
        } as ThinkingStartedData),
      );
    },
    onReasoning: (content, partId) => {
      markSessionActivity();
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "reasoning.delta", {
          kind: "reasoning.delta",
          content,
          partId: partId || "unknown",
        } as ReasoningDeltaData),
      );
    },
    onText: (content, partId) => {
      markSessionActivity();
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "message.delta", {
          kind: "message.delta",
          content,
          partId: partId || "unknown",
        } as MessageDeltaData),
      );
    },
    onToolCall: (toolCall: ToolCall) => {
      markSessionActivity();
      console.log(
        `[OpenCode] tool.started session=${currentSessionId} tool=${toolCall.tool || "unknown"} id=${toolCall.id}`,
      );
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "tool.started", {
          kind: "tool.started",
          toolId: toolCall.id,
          tool: toolCall.tool,
          title: toolCall.title,
          input: toolCall.input,
        } as ToolStartedData),
      );
    },
    onToolCallFinished: (toolCall: ToolCall) => {
      markSessionActivity();
      // @ts-ignore - SDK tool call fields vary by version.
      const isError =
        toolCall.state?.status === "error" || toolCall.status === "error";
      console.log(
        `[OpenCode] tool.${isError ? "error" : "completed"} session=${currentSessionId} tool=${toolCall.tool || "unknown"} id=${toolCall.id}${toolCall.error ? ` error=${toolCall.error}` : ""}`,
      );
      if (isError) {
        agentEventEmitter.emitSessionEvent(
          currentSessionId,
          createAgentEvent(currentSessionId, "tool.error", {
            kind: "tool.error",
            toolId: toolCall.id,
            tool: toolCall.tool,
            error: toolCall.error,
          } as ToolErrorData),
        );
      } else {
        agentEventEmitter.emitSessionEvent(
          currentSessionId,
          createAgentEvent(currentSessionId, "tool.completed", {
            kind: "tool.completed",
            toolId: toolCall.id,
            tool: toolCall.tool,
          } as ToolCompletedData),
        );
      }
    },
    onUsageUpdated: async (data) => {
      markSessionActivity();
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "usage.updated", {
          kind: "usage.updated",
          cost: data.cost,
          tokens: data.tokens,
        } as UsageUpdatedData),
      );

      // Report usage to backend in connected mode
      const sessionTitle = await getSessionTitle(client, directory, currentSessionId);
      await usageReporter.report(
        data,
        currentSessionId,
        sessionTitle,
        process.env.VIVD_PROJECT_SLUG || cwd,
      );
    },
    onIdle: async () => {
      if (completionHandled || idleFinalizationInFlight) return;
      idleFinalizationInFlight = true;
      let shouldFinalize = true;

      try {
        const terminalState = await inspectLatestAssistantTerminalState({
          client,
          directory,
          sessionId: currentSessionId,
        });
        if (!terminalState.isTerminal) {
          shouldFinalize = false;
          console.warn(
            `[OpenCode] Ignoring idle completion for non-terminal session=${currentSessionId} reason=${terminalState.reason}`,
          );
          return;
        }

        await maybeSoftCompactSession({
          client,
          directory,
          sessionId: currentSessionId,
          modelSelection: model,
        });
      } finally {
        idleFinalizationInFlight = false;
        requestBucketSyncForSettledActivity();
        if (shouldFinalize) {
          finalizeSessionRun();
        }
      }
    },
    onSessionError: (error) => {
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "session.error", {
          kind: "session.error",
          errorType: error.type,
          message: error.message,
          attempt: error.attempt,
          nextRetryAt: error.nextRetryAt,
        } as SessionErrorData),
      );
      if (error.type === "error") {
        agentLeaseReporter.finishRun(leaseRunId);
      }
    },
  });

  try {
    await start();
  } catch (error) {
    console.error("[OpenCode] Failed to start event stream:", error);
    const message = toErrorMessage(error, "Failed to start event stream");
    agentEventEmitter.emitSessionEvent(
      currentSessionId,
      createAgentEvent(currentSessionId, "session.error", {
        kind: "session.error",
        errorType: "stream",
        message,
      } as SessionErrorData),
    );
    agentEventEmitter.setSessionStatus(currentSessionId, { type: "idle" });
    agentLeaseReporter.finishRun(leaseRunId);
    stop();
    throw new Error(message);
  }

  try {
    const systemPrompt =
      isNewSession && !options?.skipSessionStartSystemPrompt
      ? await agentInstructionsService.getSystemPromptForSessionStart({
          projectSlug: (process.env.VIVD_PROJECT_SLUG || "").trim() || undefined,
          projectVersion: Number.parseInt(
            process.env.VIVD_PROJECT_VERSION || "",
            10,
          ),
        })
      : undefined;
    await sendPromptAsync(
      client,
      currentSessionId,
      directory,
      task,
      model,
      options?.tools,
      systemPrompt,
    );
  } catch (error) {
    console.error(`[OpenCode] Task Error:`, error);
    const message = toErrorMessage(error, "Failed to send task to OpenCode");
    agentEventEmitter.emitSessionEvent(
      currentSessionId,
      createAgentEvent(currentSessionId, "session.error", {
        kind: "session.error",
        errorType: "task",
        message,
      } as SessionErrorData),
    );
    agentEventEmitter.setSessionStatus(currentSessionId, { type: "idle" });
    agentLeaseReporter.finishRun(leaseRunId);
    stop();
    throw new Error(message);
  }

  return { sessionId: currentSessionId };
}

export async function listSessions(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));

  let sessions = result.data || [];

  sessions = sessions.filter((s: any) => {
    if (!s.directory) return false;
    return (
      s.directory === opencodeDir ||
      s.directory.replace(/\/$/, "") === opencodeDir.replace(/\/$/, "")
    );
  });

  return sessions;
}

export async function listProjects(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.project.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function getSessionContent(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.messages({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function getMessageDiff(
  sessionId: string,
  messageId: string,
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const messagesResult = await client.session.messages({
    sessionID: sessionId,
    directory: opencodeDir,
  });

  if (messagesResult.error) {
    throw new Error(
      `Failed to load session messages for diff lookup: ${JSON.stringify(messagesResult.error)}`,
    );
  }

  const messages = Array.isArray(messagesResult.data) ? messagesResult.data : [];
  const targetMessage = messages.find(
    (message) =>
      (message &&
        typeof message === "object" &&
        typeof (message as any).info?.id === "string" &&
        (message as any).info.id === messageId) ||
      (typeof (message as any)?.id === "string" && (message as any).id === messageId),
  );
  const summaryDiffs = normalizeDetailedSessionDiffs(
    (targetMessage as any)?.info?.summary?.diffs ?? (targetMessage as any)?.summary?.diffs,
  );

  if (summaryDiffs.length > 0) {
    return summaryDiffs;
  }

  const result = await client.session.diff({
    sessionID: sessionId,
    directory: opencodeDir,
    messageID: messageId,
  });

  if (result.error) {
    throw new Error(`Failed to load session diff: ${JSON.stringify(result.error)}`);
  }

  return normalizeDetailedSessionDiffs(result.data);
}

export async function listQuestions(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.question.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function listPermissions(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.permission.list({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function createSession(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.create({ directory: opencodeDir });
  if (result.error) {
    throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) throw new Error("Session created but no ID returned");
  return result.data;
}

async function getOrCreateSession(
  client: OpencodeClient,
  directory: string,
  sessionId?: string,
): Promise<string> {
  if (sessionId) {
    return sessionId;
  }

  const result = await client.session.create({ directory });
  if (result.error) {
    throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) throw new Error("Session created but no ID returned");

  return result.data.id;
}

async function sessionHasMessages(
  client: OpencodeClient,
  directory: string,
  sessionId: string,
): Promise<boolean> {
  const result = await client.session.messages({
    sessionID: sessionId,
    directory,
  });
  if (result.error) {
    throw new Error(`Failed to load session messages: ${JSON.stringify(result.error)}`);
  }
  return Array.isArray(result.data) && result.data.length > 0;
}

async function sendPromptAsync(
  client: OpencodeClient,
  sessionId: string,
  directory: string,
  task: string,
  modelSelection?: ModelSelection,
  toolEnablement?: Record<string, boolean>,
  systemPrompt?: string,
): Promise<void> {
  const resolvedModel = modelSelection || getDefaultModel();
  if (!resolvedModel) {
    throw new Error(
      "No model configured. Set OPENCODE_MODEL_STANDARD and optionally OPENCODE_MODEL_ADVANCED / OPENCODE_MODEL_PRO.",
    );
  }
  const {
    provider: providerID,
    modelId: modelID,
    variant,
  } = resolvedModel;

  const result = await client.session.promptAsync({
    sessionID: sessionId,
    directory,
    model: { providerID, modelID },
    ...(variant ? { variant } : {}),
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...(toolEnablement ? { tools: toolEnablement } : {}),
    parts: [{ type: "text", text: task }],
  });

  if (result.error) {
    throw new Error(`Failed to prompt session: ${JSON.stringify(result.error)}`);
  }
}

export async function deleteSession(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.delete({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  agentLeaseReporter.finishSession(sessionId);
  return true;
}

export async function abortSession(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.abort({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));

  agentLeaseReporter.finishSession(sessionId);
  agentEventEmitter.setSessionStatus(sessionId, { type: "idle" });
  agentEventEmitter.emitSessionEvent(
    sessionId,
    createAgentEvent(sessionId, "session.completed", {
      kind: "session.completed",
    } as SessionCompletedData),
  );

  return true;
}

export async function replyQuestion(
  requestId: string,
  answers: string[][],
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.question.reply({
    requestID: requestId,
    directory: opencodeDir,
    answers,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function rejectQuestion(requestId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.question.reject({
    requestID: requestId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function respondPermission(
  requestId: string,
  sessionId: string,
  response: "once" | "always" | "reject",
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.permission.respond({
    permissionID: requestId,
    sessionID: sessionId,
    response,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function unrevertSession(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);

  const result = await client.session.unrevert({
    sessionID: sessionId,
    directory: opencodeDir,
  });
  if (result.error) throw new Error(JSON.stringify(result.error));

  return result.data;
}

export async function getSessionsStatus(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const sessions = await listSessions(directory);
  const result = await client.session.status({ directory: opencodeDir });
  if (result.error) throw new Error(JSON.stringify(result.error));

  const normalizedStatuses = normalizeSessionStatuses(result.data, sessions);
  const emitterStatuses = agentEventEmitter.getSessionStatuses();
  const emitterStatusSnapshots = agentEventEmitter.getSessionStatusSnapshots();
  const FRESH_BUSY_STATUS_MAX_AGE_MS = 2_000;
  const now = Date.now();

  const statusMap: Record<string, SessionStatus> = {};
  for (const session of sessions) {
    const normalized = normalizedStatuses[session.id];
    const emitter = emitterStatuses[session.id];
    const emitterUpdatedAt = emitterStatusSnapshots[session.id]?.updatedAt ?? 0;
    const emitterAgeMs = emitterUpdatedAt > 0 ? now - emitterUpdatedAt : Infinity;
    const hasFreshEmitterBusy =
      emitter?.type === "busy" && emitterAgeMs <= FRESH_BUSY_STATUS_MAX_AGE_MS;
    const hasEmitterRetryOrError =
      emitter?.type === "retry" || emitter?.type === "error";

    if (normalized) {
      // Prefer OpenCode's explicit current status over emitter snapshots so
      // bootstrap refreshes do not resurrect a stale local busy state.
      if (normalized.type === "idle" && emitter && hasEmitterRetryOrError) {
        // Keep retry/error visibility when OpenCode collapses back to idle
        // before the retry/error state is reflected in bootstrap status.
        statusMap[session.id] = emitter;
      } else {
        statusMap[session.id] = normalized;
      }
      continue;
    }

    // Backend payloads can be partial/ambiguous. Keep retry visibility and
    // trust only a short-lived local busy status; otherwise default to idle.
    if (emitter && (hasEmitterRetryOrError || hasFreshEmitterBusy)) {
      statusMap[session.id] = emitter;
      continue;
    }

    statusMap[session.id] = { type: "idle" };
  }

  return statusMap;
}

function isSessionStatusLike(value: unknown): value is SessionStatus {
  if (!value || typeof value !== "object") return false;
  const type = (value as any).type;
  return (
    type === "idle" ||
    type === "busy" ||
    type === "done" ||
    type === "retry" ||
    type === "error"
  );
}

function normalizeSessionStatuses(
  data: unknown,
  sessions: { id: string }[],
): Record<string, SessionStatus> {
  if (!data) return {};

  if (Array.isArray(data)) {
    const mapped: Record<string, SessionStatus> = {};
    const unkeyed: SessionStatus[] = [];
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, any>;
      const id = record.sessionID ?? record.sessionId ?? record.id;
      const statusCandidate = record.status ?? record;
      if (!isSessionStatusLike(statusCandidate)) continue;
      const status = statusCandidate as SessionStatus;

      if (id) {
        mapped[id] = status;
      } else {
        unkeyed.push(status);
      }
    }

    if (Object.keys(mapped).length > 0) {
      return mapped;
    }

    if (unkeyed.length === sessions.length && sessions.length > 0) {
      const indexMapped: Record<string, SessionStatus> = {};
      sessions.forEach((session, index) => {
        const status = unkeyed[index];
        if (status) indexMapped[session.id] = status;
      });
      if (Object.keys(indexMapped).length > 0) {
        return indexMapped;
      }
    }

    if (unkeyed.length === 1 && sessions.length === 1) {
      return { [sessions[0].id]: unkeyed[0] };
    }

    return {};
  }

  if (data instanceof Map) {
    return Object.fromEntries(Array.from(data.entries())) as Record<
      string,
      SessionStatus
    >;
  }

  if (typeof data === "object") {
    if (isSessionStatusLike(data)) {
      if (sessions.length === 1) {
        return { [sessions[0].id]: data };
      }
      return {};
    }
    return data as Record<string, SessionStatus>;
  }

  return {};
}

function toErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) {
    return value.message || fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (value && typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore serialization failures.
    }
  }
  return fallback;
}

async function getMissingSnapshotHashes(
  directory: string,
  hashes: string[],
): Promise<string[]> {
  if (!hashes.length) {
    return [];
  }

  const snapshotState = await resolveOpencodeSnapshotGitState(directory);
  if (!snapshotState) {
    return [];
  }

  return hashes.filter(
    (hash) =>
      !snapshotGitDirHasObject(
        snapshotState.snapshotGitDir,
        snapshotState.worktree,
        hash,
      ),
  );
}

export async function revertToUserMessage(
  sessionId: string,
  userMessageId: string,
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);

  let patchHistory: RevertPatchHistory = { files: [], hashes: [] };
  let priorRevertMessageId: string | undefined;
  const trackedFileFingerprintsBefore = await captureTrackedFileFingerprints(
    directory,
    patchHistory.files,
  );
  try {
    const messagesRes = await client.session.messages({
      sessionID: sessionId,
      directory: opencodeDir,
    });
    if (!messagesRes.error && Array.isArray(messagesRes.data)) {
      patchHistory = getPatchHistoryForMessageRevert(
        messagesRes.data as SessionMessageRecord[],
        userMessageId,
      );
    }
  } catch {
    // Best-effort only.
  }
  const trackedFilesBefore =
    patchHistory.files.length > 0
      ? await captureTrackedFileFingerprints(directory, patchHistory.files)
      : trackedFileFingerprintsBefore;

  const missingSnapshotHashes = await getMissingSnapshotHashes(
    directory,
    patchHistory.hashes,
  );
  if (missingSnapshotHashes.length > 0) {
    console.warn(
      `[OpenCode][revert] missing snapshot history for session=${sessionId} message=${userMessageId} missingHashes=${missingSnapshotHashes.length}`,
    );
    return {
      reverted: false,
      reason: "missing_snapshot_history" as const,
      messageId: userMessageId,
      trackedFiles: patchHistory.files.slice(0, 50),
    };
  }

  try {
    const before = await client.session.get({
      sessionID: sessionId,
      directory: opencodeDir,
    });
    priorRevertMessageId = readSessionString(before.data?.revert?.messageID);
  } catch {
    // Best-effort only.
  }

  const result = await client.session.revert({
    sessionID: sessionId,
    directory: opencodeDir,
    messageID: userMessageId,
  });

  if (result.error) {
    throw new Error(`Revert failed: ${JSON.stringify(result.error)}`);
  }

  const afterRevertMessageId = readSessionString(result.data?.revert?.messageID);
  const revertDiff =
    typeof result.data?.revert?.diff === "string" ? result.data.revert.diff : undefined;
  const trackedFilesFromResult = getTrackedFilesFromUnifiedDiff(revertDiff);
  const trackedFilesAfter =
    patchHistory.files.length > 0
      ? await captureTrackedFileFingerprints(directory, patchHistory.files)
      : trackedFilesBefore;
  const revertedByMetadata =
    afterRevertMessageId === userMessageId &&
    priorRevertMessageId !== afterRevertMessageId;
  const revertedByWorkspaceChange = didTrackedFileFingerprintsChange(
    trackedFilesBefore,
    trackedFilesAfter,
  );
  const reverted = revertedByMetadata || revertedByWorkspaceChange;
  const trackedFiles = reverted
    ? trackedFilesFromResult.length > 0
      ? trackedFilesFromResult
      : patchHistory.files
    : [];

  if (!reverted) {
    console.warn(
      `[OpenCode][revert] no-op session=${sessionId} message=${userMessageId} revertBefore=${priorRevertMessageId || "none"} revertAfter=${afterRevertMessageId || "none"}`,
    );
  }

  return {
    reverted,
    messageId: userMessageId,
    trackedFiles: trackedFiles.slice(0, 50),
  };
}
