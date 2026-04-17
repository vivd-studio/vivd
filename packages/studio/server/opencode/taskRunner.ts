import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import crypto from "node:crypto";
import { useEvents, type ToolCall } from "./useEvents.js";
import {
  agentEventEmitter,
  createAgentEvent,
  type MessageDeltaData,
  type ReasoningDeltaData,
  type SessionCompletedData,
  type SessionErrorData,
  type ThinkingStartedData,
  type ToolCompletedData,
  type ToolErrorData,
  type ToolStartedData,
  type UsageUpdatedData,
} from "./eventEmitter.js";
import { serverManager } from "./serverManager.js";
import { usageReporter } from "../services/reporting/UsageReporter.js";
import { agentLeaseReporter } from "../services/reporting/AgentLeaseReporter.js";
import { requestBucketSyncAfterAgentTask } from "../services/sync/AgentTaskSyncService.js";
import { agentInstructionsService } from "../services/agent/AgentInstructionsService.js";
import { workspaceEventPump } from "./events/workspaceEventPump.js";
import type { ModelSelection } from "./modelConfig.js";
import { getDefaultModel } from "./modelConfig.js";
import {
  getSessionTitle,
  inspectLatestAssistantTerminalState,
  maybeSoftCompactSession,
  toErrorMessage,
} from "./sessionHelpers.js";
import { getOrCreateSession, sessionHasMessages } from "./sessionApi.js";

export async function runTask(
  task: string,
  cwd: string,
  sessionId?: string,
  model?: ModelSelection,
  options?: {
    tools?: Record<string, boolean>;
    skipSessionStartSystemPrompt?: boolean;
    sessionStartSystemPromptSuffix?: string;
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
    const baseSystemPrompt =
      isNewSession && !options?.skipSessionStartSystemPrompt
      ? await agentInstructionsService.getSystemPromptForSessionStart({
          projectSlug: (process.env.VIVD_PROJECT_SLUG || "").trim() || undefined,
          projectVersion: Number.parseInt(
            process.env.VIVD_PROJECT_VERSION || "",
            10,
          ),
        })
      : undefined;
    const promptSuffix = options?.sessionStartSystemPromptSuffix?.trim();
    const systemPrompt = promptSuffix
      ? baseSystemPrompt
        ? `${baseSystemPrompt.trim()}\n\n${promptSuffix}`
        : promptSuffix
      : baseSystemPrompt;
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
