import {
  createOpencode,
  createOpencodeClient,
  OpencodeClient,
} from "@opencode-ai/sdk";
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
} from "./eventEmitter";

export { useEvents };
export { agentEventEmitter } from "./eventEmitter";
export type { AgentEvent, AgentEventType } from "./eventEmitter";

let serverUrl: string;

export async function initOpencode() {
  console.log(
    `[OpenCode] Starting internal server with model ${process.env.OPENCODE_MODEL}`
  );
  const opencode = await createOpencode({
    config: { model: process.env.OPENCODE_MODEL },
  });
  console.log(
    `[OpenCode] Server Initialized. Server URL: ${opencode.server.url}`
  );
  serverUrl = opencode.server.url;

  return opencode;
}

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

  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }

  const client = createOpencodeClient({
    baseUrl: serverUrl,
    directory: cwd,
  });

  const currentSessionId = await getOrCreateSession(client, cwd, sessionId);

  // Track reasoning part IDs for delta updates
  const reasoningPartIds = new Map<string, number>();

  // We start the event stream but don't wait for it to finish
  const { start, stop } = useEvents(client, {
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
      // @ts-ignore
      const input = toolCall.input || {};
      const inputStr =
        Object.keys(input).length > 0 ? ` input: ${JSON.stringify(input)}` : "";
      console.log(
        `[OpenCode] Tool Call: ${toolCall.tool}${
          // @ts-ignore
          toolCall.title ? ` - ${toolCall.title}` : ""
        }${inputStr}`
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
  });

  // Start listening to events in the background
  start();

  // Trigger the prompt in the background
  sendPrompt(client, currentSessionId, cwd, task)
    .then(async () => {
      console.log(`[OpenCode] Task execution completed`);
      // Emit session completed event to frontend
      agentEventEmitter.emitSessionEvent(
        currentSessionId,
        createAgentEvent(currentSessionId, "session.completed", {
          kind: "session.completed",
        } as SessionCompletedData)
      );
    })
    .catch((error) => {
      console.error(`[OpenCode] Background Task Error:`, error);
    })
    .finally(() => {
      // Ensure we stop the event stream or we'll leak listeners/connections
      // which results in duplicated logs for subsequent tasks.
      stop();
    });

  return { sessionId: currentSessionId };
}

export async function listSessions(directory?: string) {
  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }
  const client = createOpencodeClient({ baseUrl: serverUrl });
  const query = directory ? { directory } : {};
  const result = await client.session.list({ query });
  if (result.error) throw new Error(JSON.stringify(result.error));

  let sessions = result.data || [];

  if (directory) {
    // Manual filtering is necessary as the API might return all sessions
    sessions = sessions.filter((s: any) => {
      if (!s.directory) return false;
      // Simple exact match or trailing slash agnostic match
      return (
        s.directory === directory ||
        s.directory.replace(/\/$/, "") === directory.replace(/\/$/, "")
      );
    });
  }

  return sessions;
}

export async function listProjects() {
  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }
  const client = createOpencodeClient({ baseUrl: serverUrl });
  // @ts-ignore
  const result = await client.project.list({});
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data || [];
}

export async function getSessionContent(sessionId: string) {
  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }
  const client = createOpencodeClient({ baseUrl: serverUrl });
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

async function sendPrompt(
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
    // TODO: change this to promptAsync
    const result = await client.session.prompt({
      path: { id: sessionId },
      query: { directory: cwd },
      body: {
        model: { providerID, modelID },
        parts: [{ type: "text", text: task }],
      },
    });
    if (result.error)
      throw new Error(
        `Failed to prompt session: ${JSON.stringify(result.error)}`
      );
  } catch (error: any) {
    console.error(`[OpenCode] Error:`, error);
    throw new Error(`OpenCode task failed: ${error.message}`);
  }

  // console.log(`[OpenCode] Prompt sent to session: ${sessionId}`);
}

export async function deleteSession(sessionId: string, directory?: string) {
  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }
  const client = createOpencodeClient({ baseUrl: serverUrl, directory });
  const result = await client.session.delete({ path: { id: sessionId } });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return true;
}

export async function revertSession(
  sessionId: string,
  messageID: string,
  directory?: string,
  partID?: string
) {
  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }
  const client = createOpencodeClient({ baseUrl: serverUrl, directory });
  const result = await client.session.revert({
    path: { id: sessionId },
    body: { messageID, partID },
  });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data;
}

export async function unrevertSession(sessionId: string, directory?: string) {
  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }
  const client = createOpencodeClient({ baseUrl: serverUrl, directory });
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
export async function revertToUserMessage(
  sessionId: string,
  userMessageId: string,
  directory?: string
) {
  if (!serverUrl) {
    throw new Error("OpenCode server not initialized");
  }

  const client = createOpencodeClient({ baseUrl: serverUrl, directory });

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
