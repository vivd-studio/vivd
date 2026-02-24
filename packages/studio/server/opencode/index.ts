import type { OpencodeClient } from "@opencode-ai/sdk";
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
import { requestBucketSyncAfterAgentTask } from "../services/sync/AgentTaskSyncService.js";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService.js";

import type { ModelSelection } from "./modelConfig.js";
import { getDefaultModel } from "./modelConfig.js";

export { useEvents };
export { agentEventEmitter } from "./eventEmitter.js";
export type { AgentEvent, AgentEventType } from "./eventEmitter.js";
export { serverManager } from "./serverManager.js";
export { getAvailableModels } from "./modelConfig.js";
export type { ModelTier, ModelSelection } from "./modelConfig.js";

const sessionTitleCache = new Map<
  string,
  { title: string | undefined; fetchedAt: number }
>();

const DEFAULT_TITLE_TTL_MS = 30_000;
const PENDING_TITLE_TTL_MS = 5_000;

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
    const result = await client.session.list({ query: { directory: cwd } });
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

export async function runTask(
  task: string,
  cwd: string,
  sessionId?: string,
  model?: ModelSelection,
  options?: {
    tools?: Record<string, boolean>;
  },
): Promise<{ sessionId: string }> {
  console.log(
    `[OpenCode] Starting task in ${cwd}: "${task}" (Session: ${
      sessionId || "New"
    })`,
  );

  const { client, directory } = await serverManager.getClientAndDirectory(cwd);

  const currentSessionId = await getOrCreateSession(client, directory, sessionId);
  const isNewSession = !sessionId;
  agentEventEmitter.setSessionStatus(currentSessionId, { type: "busy" });
  let completionHandled = false;

  const { start, stop } = useEvents(client, {
    sessionId: currentSessionId,
    onStartThinking: () => {
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "thinking.started", {
          kind: "thinking.started",
        } as ThinkingStartedData),
      );
    },
    onReasoning: (content, partId) => {
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
      // @ts-ignore - SDK tool call fields vary by version.
      const isError =
        toolCall.state?.status === "error" || toolCall.status === "error";
      if (isError) {
        agentEventEmitter.emitSessionEvent(
          currentSessionId,
          createAgentEvent(currentSessionId, "tool.error", {
            kind: "tool.error",
            toolId: toolCall.id,
            tool: toolCall.tool,
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
    onIdle: () => {
      if (completionHandled) return;
      completionHandled = true;

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
      requestBucketSyncAfterAgentTask({
        sessionId: currentSessionId,
        projectDir: directory,
      });
      stop();
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
    },
  });

  try {
    await start();
  } catch (error) {
    console.error("[OpenCode] Failed to start event stream:", error);
  }

  try {
    const systemPrompt = isNewSession
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
    agentEventEmitter.setSessionStatus(currentSessionId, { type: "idle" });
    stop();
  }

  return { sessionId: currentSessionId };
}

export async function listSessions(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.list({ query: { directory: opencodeDir } });
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
  const { client } = await serverManager.getClientAndDirectory(directory);
  // @ts-ignore - SDK typings vary by version.
  const result = await client.project.list({});
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function getSessionContent(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const result = await client.session.messages({
    path: { id: sessionId },
    // @ts-ignore - SDK typings vary by version.
    query: { directory: opencodeDir },
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

async function getOrCreateSession(
  client: OpencodeClient,
  directory: string,
  sessionId?: string,
): Promise<string> {
  if (sessionId) {
    return sessionId;
  }

  const result = await client.session.create({ query: { directory } });
  if (result.error) {
    throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
  }
  if (!result.data?.id) throw new Error("Session created but no ID returned");

  return result.data.id;
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
      "No model configured. Set OPENCODE_MODELS or OPENCODE_MODEL environment variable.",
    );
  }
  const { provider: providerID, modelId: modelID } = resolvedModel;

  const result = await client.session.promptAsync({
    path: { id: sessionId },
    query: { directory },
    body: {
      model: { providerID, modelID },
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(toolEnablement ? { tools: toolEnablement } : {}),
      parts: [{ type: "text", text: task }],
    },
  });

  if (result.error) {
    throw new Error(`Failed to prompt session: ${JSON.stringify(result.error)}`);
  }
}

export async function deleteSession(sessionId: string, directory: string) {
  const { client } = await serverManager.getClientAndDirectory(directory);
  const result = await client.session.delete({ path: { id: sessionId } });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function abortSession(sessionId: string, directory: string) {
  const { client } = await serverManager.getClientAndDirectory(directory);
  const result = await client.session.abort({ path: { id: sessionId } });
  if (result.error) throw new Error(JSON.stringify(result.error));

  agentEventEmitter.setSessionStatus(sessionId, { type: "idle" });
  agentEventEmitter.emitSessionEvent(
    sessionId,
    createAgentEvent(sessionId, "session.completed", {
      kind: "session.completed",
    } as SessionCompletedData),
  );

  return true;
}

export async function unrevertSession(sessionId: string, directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);

  const emitterStatus =
    agentEventEmitter.getSessionStatuses()[sessionId]?.type ?? "idle";

  let beforeRevertMessageId: string | undefined;
  try {
    const before = await client.session.get({
      path: { id: sessionId },
      query: { directory: opencodeDir },
    });
    beforeRevertMessageId = before.data?.revert?.messageID;
  } catch {
    // Best-effort only.
  }

  console.log(
    `[OpenCode][unrevert] requested session=${sessionId} status=${emitterStatus} project=${process.env.VIVD_PROJECT_SLUG || "unknown"} revertMessage=${beforeRevertMessageId || "none"}`,
  );

  const result = await client.session.unrevert({
    path: { id: sessionId },
    query: { directory: opencodeDir },
  });
  if (result.error) throw new Error(JSON.stringify(result.error));

  console.log(
    `[OpenCode][unrevert] completed session=${sessionId} revertNow=${result.data?.revert?.messageID || "none"}`,
  );

  return result.data;
}

export async function getSessionsStatus(directory: string) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const sessions = await listSessions(directory);
  const result = await client.session.status({ query: { directory: opencodeDir } });
  if (result.error) throw new Error(JSON.stringify(result.error));

  const normalizedStatuses = normalizeSessionStatuses(result.data, sessions);
  const emitterStatuses = agentEventEmitter.getSessionStatuses();

  const statusMap: Record<string, SessionStatus> = {};
  for (const session of sessions) {
    statusMap[session.id] = { type: "idle" };
  }

  for (const [sessionId, status] of Object.entries(normalizedStatuses)) {
    if (sessionId in statusMap) {
      statusMap[sessionId] = status;
    }
  }

  for (const [sessionId, status] of Object.entries(emitterStatuses)) {
    if (sessionId in statusMap) {
      statusMap[sessionId] = status;
    }
  }

  return statusMap;
}

function normalizeSessionStatuses(
  data: unknown,
  sessions: { id: string }[],
): Record<string, SessionStatus> {
  if (!data) return {};

  if (Array.isArray(data)) {
    const mapped: Record<string, SessionStatus> = {};
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, any>;
      const id = record.sessionID ?? record.sessionId ?? record.id;
      const status = (record.status ?? record) as SessionStatus;
      if (id && status && typeof status === "object" && "type" in status) {
        mapped[id] = status;
      }
    }

    if (Object.keys(mapped).length > 0) {
      return mapped;
    }

    if (data.length === 1 && sessions.length === 1) {
      const onlyStatus = data[0] as SessionStatus;
      if (onlyStatus && typeof onlyStatus === "object" && "type" in onlyStatus) {
        return { [sessions[0].id]: onlyStatus };
      }
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
    return data as Record<string, SessionStatus>;
  }

  return {};
}

export async function revertToUserMessage(
  sessionId: string,
  userMessageId: string,
  directory: string,
) {
  const { client, directory: opencodeDir } =
    await serverManager.getClientAndDirectory(directory);
  const emitterStatus =
    agentEventEmitter.getSessionStatuses()[sessionId]?.type ?? "idle";

  let diffFiles: string[] = [];
  let diffSummary: { files: number; additions: number; deletions: number } | null =
    null;
  try {
    const diffRes = await client.session.diff({
      path: { id: sessionId },
      query: { directory: opencodeDir, messageID: userMessageId },
    });
    if (!diffRes.error && Array.isArray(diffRes.data)) {
      diffFiles = diffRes.data.map((d) => d.file).filter(Boolean);
      diffSummary = diffRes.data.reduce(
        (acc, d) => {
          acc.files += 1;
          acc.additions += Number(d.additions) || 0;
          acc.deletions += Number(d.deletions) || 0;
          return acc;
        },
        { files: 0, additions: 0, deletions: 0 },
      );
    }
  } catch {
    // Best-effort only.
  }

  console.log(
    `[OpenCode][revert] requested session=${sessionId} status=${emitterStatus} project=${process.env.VIVD_PROJECT_SLUG || "unknown"} message=${userMessageId} trackedFiles=${diffSummary?.files ?? "unknown"} (+${diffSummary?.additions ?? "?"} -${diffSummary?.deletions ?? "?"})`,
  );

  if (diffSummary && diffSummary.files === 0) {
    console.warn(
      `[OpenCode][revert] no tracked diff for message=${userMessageId}. This usually means the agent changed files via shell commands instead of patch edits, so revert will be a no-op.`,
    );
  }

  const result = await client.session.revert({
    path: { id: sessionId },
    query: { directory: opencodeDir },
    body: { messageID: userMessageId },
  });

  if (result.error) {
    throw new Error(`Revert failed: ${JSON.stringify(result.error)}`);
  }

  try {
    const afterDiff = await client.session.diff({
      path: { id: sessionId },
      query: { directory: opencodeDir, messageID: userMessageId },
    });
    if (!afterDiff.error && Array.isArray(afterDiff.data)) {
      console.log(
        `[OpenCode][revert] completed session=${sessionId} message=${userMessageId} remainingFiles=${afterDiff.data.length} revertState=${result.data?.revert?.messageID || "none"}`,
      );
    }
  } catch {
    console.log(
      `[OpenCode][revert] completed session=${sessionId} message=${userMessageId} revertState=${result.data?.revert?.messageID || "none"}`,
    );
  }

  return {
    reverted: true,
    messageId: userMessageId,
    trackedFiles: diffFiles.slice(0, 50),
  };
}
