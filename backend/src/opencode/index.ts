import { OpencodeClient } from "@opencode-ai/sdk";
import { useEvents, type ToolCall } from "./useEvents";
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
} from "./eventEmitter";
import { serverManager } from "./serverManager";

export { useEvents };
export { agentEventEmitter } from "./eventEmitter";
export type { AgentEvent, AgentEventType } from "./eventEmitter";
export { serverManager } from "./serverManager";

export async function runTask(
  task: string,
  cwd: string,
  sessionId?: string
): Promise<{ sessionId: string }> {
  console.log(
    `[OpenCode] Starting task in ${cwd}: "${task}" (Session: ${
      sessionId || "New"
    })`
  );

  // Lazily create/get server for this project directory
  const client = await serverManager.getClient(cwd);

  const currentSessionId = await getOrCreateSession(client, cwd, sessionId);
  agentEventEmitter.setSessionStatus(currentSessionId, { type: "busy" });

  // We start the event stream but don't wait for it to finish
  const { start, stop } = useEvents(client, {
    sessionId: currentSessionId,
    onStartThinking: () => {
      console.log(`[OpenCode] Thinking...`);
      // Emit thinking started event to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "thinking.started", {
          kind: "thinking.started",
        } as ThinkingStartedData)
      );
    },
    onReasoning: (content, partId) => {
      // Emit reasoning delta to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "reasoning.delta", {
          kind: "reasoning.delta",
          content,
          partId: partId || "unknown",
        } as ReasoningDeltaData)
      );
    },
    onText: (content, partId) => {
      // Emit text delta to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "message.delta", {
          kind: "message.delta",
          content,
          partId: partId || "unknown",
        } as MessageDeltaData)
      );
    },
    onToolCall: (toolCall: ToolCall) => {
      console.log(
        `[OpenCode] Tool Call: ${toolCall.tool}${
          // @ts-ignore
          toolCall.title ? ` - ${toolCall.title}` : ""
        }`
      );
      // Emit tool started event to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "tool.started", {
          kind: "tool.started",
          toolId: toolCall.id,
          tool: toolCall.tool,
          title: toolCall.title,
          input: toolCall.input,
        } as ToolStartedData)
      );
    },
    onToolCallFinished: (toolCall: ToolCall) => {
      // @ts-ignore
      const isError =
        toolCall.state?.status === "error" || toolCall.status === "error";
      if (isError) {
        console.log(`[OpenCode] Tool Error: ${toolCall.tool}`);
        // Emit tool error event to frontend
        agentEventEmitter.emitSessionEvent(
          currentSessionId,
          createAgentEvent(currentSessionId, "tool.error", {
            kind: "tool.error",
            toolId: toolCall.id,
            tool: toolCall.tool,
          } as ToolErrorData)
        );
      } else {
        // Emit tool completed event to frontend
        agentEventEmitter.emitSessionEvent(
          currentSessionId,
          createAgentEvent(currentSessionId, "tool.completed", {
            kind: "tool.completed",
            toolId: toolCall.id,
            tool: toolCall.tool,
          } as ToolCompletedData)
        );
      }
    },
    onUsageUpdated: (data) => {
      // Emit usage updated event to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "usage.updated", {
          kind: "usage.updated",
          cost: data.cost,
          tokens: data.tokens,
        } as UsageUpdatedData)
      );
    },
    onIdle: () => {
      console.log(`[OpenCode] Task execution completed`);
      // Emit session completed event to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "session.completed", {
          kind: "session.completed",
        } as SessionCompletedData)
      );
      stop();
    },
    onSessionError: (error) => {
      console.error(
        `[OpenCode] Session error (${error.type}): ${error.message}`
      );
      // Emit session error event to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "session.error", {
          kind: "session.error",
          errorType: error.type,
          message: error.message,
          attempt: error.attempt,
          nextRetryAt: error.nextRetryAt,
        } as SessionErrorData)
      );
    },
  });

  try {
    // Ensure the event stream is connected before sending the prompt
    await start();
  } catch (error) {
    console.error("[OpenCode] Failed to start event stream:", error);
  }

  try {
    await sendPromptAsync(client, currentSessionId, cwd, task);
  } catch (error) {
    console.error(`[OpenCode] Task Error:`, error);
    agentEventEmitter.setSessionStatus(currentSessionId, { type: "idle" });
    stop();
  }

  return { sessionId: currentSessionId };
}

export async function listSessions(directory: string) {
  const client = await serverManager.getClient(directory);
  const result = await client.session.list({ query: { directory } });
  if (result.error) throw new Error(JSON.stringify(result.error));

  let sessions = result.data || [];

  // Manual filtering is necessary as the API might return all sessions
  sessions = sessions.filter((s: any) => {
    if (!s.directory) return false;
    // Simple exact match or trailing slash agnostic match
    return (
      s.directory === directory ||
      s.directory.replace(/\/$/, "") === directory.replace(/\/$/, "")
    );
  });

  return sessions;
}

export async function listProjects(directory: string) {
  const client = await serverManager.getClient(directory);
  // @ts-ignore
  const result = await client.project.list({});
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function getSessionContent(sessionId: string, directory: string) {
  const client = await serverManager.getClient(directory);
  const result = await client.session.messages({ path: { id: sessionId } });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

async function getOrCreateSession(
  client: OpencodeClient,
  cwd: string,
  sessionId?: string
): Promise<string> {
  if (sessionId) {
    console.log(
      `[OpenCode] Reusing existing session: ${sessionId} for directory: ${cwd}`
    );
    return sessionId;
  }

  const result = await client.session.create({ query: { directory: cwd } });
  if (result.error)
    throw new Error(
      `Failed to create session: ${JSON.stringify(result.error)}`
    );
  if (!result.data?.id) throw new Error("Session created but no ID returned");

  console.log(
    `[OpenCode] Created new session: ${result.data.id} for directory: ${cwd}`
  );
  return result.data.id;
}

async function sendPromptAsync(
  client: OpencodeClient,
  sessionId: string,
  cwd: string,
  task: string
): Promise<void> {
  const modelEnv = process.env.OPENCODE_MODEL;
  if (!modelEnv) {
    throw new Error("OPENCODE_MODEL environment variable is not set");
  }
  const [providerID, modelID] = modelEnv.split("/");

  console.log(
    `[OpenCode] Sending prompt to session: ${sessionId} for directory: ${cwd}, with model: ${modelEnv}`
  );
  try {
    const result = await client.session.promptAsync({
      path: { id: sessionId },
      query: { directory: cwd },
      body: {
        model: { providerID, modelID },
        parts: [{ type: "text", text: task }],
      },
    });

    if (result.error) {
      console.error(
        `[OpenCode] promptAsync returned error:`,
        JSON.stringify(result.error, null, 2)
      );
      throw new Error(
        `Failed to prompt session: ${JSON.stringify(result.error)}`
      );
    }
  } catch (error: any) {
    console.error(`[OpenCode] Error sending prompt:`, error);
    console.error(
      `[OpenCode] Error details:`,
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    );
    throw new Error(`OpenCode task failed: ${error.message}`);
  }
}

export async function deleteSession(sessionId: string, directory: string) {
  const client = await serverManager.getClient(directory);
  const result = await client.session.delete({ path: { id: sessionId } });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function revertSession(
  sessionId: string,
  messageID: string,
  directory: string,
  partID?: string
) {
  const client = await serverManager.getClient(directory);
  const result = await client.session.revert({
    path: { id: sessionId },
    body: { messageID, partID },
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data;
}

export async function unrevertSession(sessionId: string, directory: string) {
  const client = await serverManager.getClient(directory);
  const result = await client.session.unrevert({
    path: { id: sessionId },
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data;
}

/**
 * Reverts changes made after a specific user message.
 * OpenCode uses git under the hood, so reverting the first assistant message
 * after the user message will revert all changes from that task.
 */
/**
 * Get the status of all sessions.
 * Returns a map of sessionId -> SessionStatus where status can be:
 * - { type: "idle" } - Session is not active
 * - { type: "busy" } - Session is actively processing
 * - { type: "retry", attempt, message, next } - Retrying after error
 */
export async function getSessionsStatus(directory: string) {
  const client = await serverManager.getClient(directory);
  const sessions = await listSessions(directory);
  const result = await client.session.status({
    query: { directory },
  });
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
  sessions: { id: string }[]
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
      if (
        onlyStatus &&
        typeof onlyStatus === "object" &&
        "type" in onlyStatus
      ) {
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
  directory: string
) {
  const client = await serverManager.getClient(directory);

  // Revert to the user message directly - OpenCode will revert all changes after this point
  console.log(`[Revert] Reverting to message: ${userMessageId}`);

  const result = await client.session.revert({
    path: { id: sessionId },
    body: { messageID: userMessageId },
  });

  if (result.error) {
    console.error("[Revert] Revert failed:", result.error);
    throw new Error(`Revert failed: ${JSON.stringify(result.error)}`);
  }

  console.log("[Revert] Revert successful");
  return { reverted: true, messageId: userMessageId };
}
