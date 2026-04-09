import { OpencodeClient } from "@opencode-ai/sdk/v2";

export interface ToolCall {
  tool: string;
  title?: string;
  input?: any;
  error?: string;
  status: "running" | "completed" | "error";
  id: string;
  state?: {
    status?: "running" | "completed" | "error";
    input?: any;
  };
}

export interface UsageData {
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
  partId?: string;
}

export interface EventCallbacks {
  sessionId?: string;
  onEvent?: (event: any) => void;
  onStartThinking?: () => void;
  onReasoning?: (content: string, partId: string) => void;
  onText?: (content: string, partId: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolCallFinished?: (toolCall: ToolCall) => void;
  onUsageUpdated?: (data: UsageData) => void;
  onIdle?: () => void;
  onSessionError?: (error: {
    type: string;
    message: string;
    attempt?: number;
    nextRetryAt?: number;
  }) => void;
}

const INACTIVITY_TIMEOUT_MS = 60 * 1000;
const IDLE_SETTLE_MS = 1_500;
type ToolStatus = "running" | "completed" | "error";
const DEBUG_EVENTS = new Set(["1", "true", "yes", "on"]).has(
  (process.env.VIVD_OPENCODE_DEBUG_EVENTS || "").trim().toLowerCase(),
);

export function useEvents(client: OpencodeClient, callbacks: EventCallbacks = {}) {
  let isActive = true;
  let lastEvent: any = null;
  let lastEventTime: number = Date.now();
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetInactivityTimer = () => {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(() => {
      if (isActive && lastEvent) {
        const summary = summarizeEvent(lastEvent);
        console.warn(
          `[useEvents] No events received for ${
            INACTIVITY_TIMEOUT_MS / 1000
          }s. Last event summary:`,
          JSON.stringify(summary),
        );
        console.warn(
          `[useEvents] Last event was at: ${new Date(
            lastEventTime,
          ).toISOString()}`,
        );
        if (DEBUG_EVENTS) {
          const raw = JSON.stringify(lastEvent);
          const maxLength = 4000;
          const clipped =
            raw.length > maxLength ? `${raw.slice(0, maxLength)}...[truncated]` : raw;
          console.warn(`[useEvents][debug] Last event payload: ${clipped}`);
        }
      }
    }, INACTIVITY_TIMEOUT_MS);
  };

  const cancelIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const scheduleIdleCallback = (shouldEmitIdle: boolean) => {
    if (!shouldEmitIdle || idleTimer) {
      return;
    }

    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!isActive) {
        return;
      }
      callbacks.onIdle?.();
    }, IDLE_SETTLE_MS);
  };

  const start = async () => {
    const events = await client.event.subscribe();
    const filterSessionId = callbacks.sessionId;

    resetInactivityTimer();

    (async () => {
      try {
        const seenParts = new Set<string>();
        const toolStates = new Map<string, string>();
        const reasoningState = new Map<string, number>();
        const textState = new Map<string, number>();
        const usageState = new Map<string, number>();
        const messageRoles = new Map<string, string>();
        const partTypes = new Map<string, string>();
        const assistantMessageIds = new Set<string>();
        const pendingUnknownTextByMessage = new Map<
          string,
          Array<{ partId: string; delta: string }>
        >();
        const loggedEncryptedToolMarkers = new Set<string>();
        let hasObservedAssistantActivity = false;
        let hasTerminalSessionError = false;

        const queueUnknownText = (
          messageId: string,
          partId: string,
          delta: string,
        ) => {
          if (!messageId || !partId || !delta) return;
          const pending = pendingUnknownTextByMessage.get(messageId) ?? [];
          pending.push({ partId, delta });
          pendingUnknownTextByMessage.set(messageId, pending);
        };

        const flushPendingUnknownTextIfKnown = (messageId: string) => {
          if (!messageId) return;
          const pending = pendingUnknownTextByMessage.get(messageId);
          if (!pending || pending.length === 0) return;

          const role = messageRoles.get(messageId);
          const isAssistantMessage =
            role === "assistant" || assistantMessageIds.has(messageId);

          if (isAssistantMessage) {
            for (const chunk of pending) {
              callbacks.onText?.(chunk.delta, chunk.partId);
            }
            pendingUnknownTextByMessage.delete(messageId);
            return;
          }

          if (role === "user") {
            pendingUnknownTextByMessage.delete(messageId);
          }
        };

        const emitOrBufferTextChunk = ({
          messageId,
          partId,
          delta,
          messageRole,
          isAssistantMessage,
        }: {
          messageId: string;
          partId: string;
          delta: string;
          messageRole: string | undefined;
          isAssistantMessage: boolean;
        }) => {
          if (!delta) return;
          if (isAssistantMessage) {
            callbacks.onText?.(delta, partId);
            return;
          }
          if (messageRole === "user") {
            return;
          }
          queueUnknownText(messageId, partId, delta);
        };

        for await (const event of events.stream) {
          if (!isActive) break;

          try {
            if (filterSessionId) {
              const eventSessionId = getEventSessionId(event);
              if (!eventSessionId || eventSessionId !== filterSessionId) {
                continue;
              }
            }

            lastEvent = event;
            lastEventTime = Date.now();
            resetInactivityTimer();

            callbacks.onEvent?.(event);

            if (event.type === "message.updated") {
              cancelIdleTimer();
              const { info } = (event as any).properties;
              if (info?.id && typeof info.id === "string") {
                if (typeof info.role === "string") {
                  messageRoles.set(info.id, info.role);
                }
                if (info?.role === "assistant") {
                  assistantMessageIds.add(info.id);
                }
                flushPendingUnknownTextIfKnown(info.id);
              }
            }

            if (event.type === "message.part.updated") {
              cancelIdleTimer();
              const { part, delta } = (event as any).properties;
              const partDelta = typeof delta === "string" ? delta : "";
              if (part?.id && typeof part.id === "string" && part?.type) {
                partTypes.set(part.id, String(part.type));
              }
              const messageId =
                typeof part?.messageID === "string" ? part.messageID : "";
              const messageRole = messageRoles.get(messageId);
              const isAssistantMessage =
                messageRole === "assistant" || assistantMessageIds.has(messageId);
              hasObservedAssistantActivity = true;

              if (part.type === "step-finish") {
                if (part.cost !== undefined && callbacks.onUsageUpdated) {
                  const lastCost = usageState.get(part.id) || 0;
                  const currentCost = part.cost;
                  const delta = currentCost - lastCost;

                  if (delta > 0) {
                    usageState.set(part.id, currentCost);
                    callbacks.onUsageUpdated({
                      cost: delta,
                      tokens:
                        part.tokens || {
                          input: 0,
                          output: 0,
                          reasoning: 0,
                          cache: { read: 0, write: 0 },
                        },
                      partId: part.id,
                    });
                  }
                }
              } else if (part.type === "reasoning") {
                const encryptedToolMarkers = getEncryptedToolMarkers(part);
                for (const marker of encryptedToolMarkers) {
                  if (!loggedEncryptedToolMarkers.has(marker)) {
                    loggedEncryptedToolMarkers.add(marker);
                    console.warn(
                      `[useEvents] Detected encrypted tool marker in reasoning metadata: ${marker} (session=${getEventSessionId(event) || callbacks.sessionId || "unknown"})`,
                    );
                  }
                }
                if (messageId) {
                  assistantMessageIds.add(messageId);
                  flushPendingUnknownTextIfKnown(messageId);
                }
                // Reasoning parts can arrive before the corresponding assistant message
                // has been seen via `message.updated`. We still want to stream them so
                // the UI can show thought blocks during generation.

                if (!seenParts.has(part.id)) {
                  callbacks.onStartThinking?.();
                  seenParts.add(part.id);
                }

                const text = part.text || "";
                const lastLength = reasoningState.get(part.id) || 0;
                if (partDelta.length > 0) {
                  callbacks.onReasoning?.(partDelta, part.id);
                  if (text.length >= lastLength + partDelta.length) {
                    reasoningState.set(part.id, text.length);
                  } else {
                    reasoningState.set(part.id, lastLength + partDelta.length);
                  }
                } else if (text.length > lastLength) {
                  const newContent = text.slice(lastLength);
                  callbacks.onReasoning?.(newContent, part.id);
                  reasoningState.set(part.id, text.length);
                }
              } else if (part.type === "text") {
                const text = part.text || "";
                const lastLength = textState.get(part.id) || 0;
                if (partDelta.length > 0) {
                  if (text.length >= lastLength + partDelta.length) {
                    textState.set(part.id, text.length);
                  } else {
                    textState.set(part.id, lastLength + partDelta.length);
                  }
                  emitOrBufferTextChunk({
                    messageId,
                    partId: part.id,
                    delta: partDelta,
                    messageRole,
                    isAssistantMessage,
                  });
                } else if (text.length > lastLength) {
                  const newContent = text.slice(lastLength);
                  textState.set(part.id, text.length);
                  emitOrBufferTextChunk({
                    messageId,
                    partId: part.id,
                    delta: newContent,
                    messageRole,
                    isAssistantMessage,
                  });
                }
              } else if (part.type === "tool") {
                if (messageId) {
                  assistantMessageIds.add(messageId);
                  flushPendingUnknownTextIfKnown(messageId);
                }
                const currentStatus = getToolStatus(part);
                if (!currentStatus) {
                  continue;
                }

                const prevStatus = toolStates.get(part.id);

                if (currentStatus !== prevStatus) {
                  toolStates.set(part.id, currentStatus);

                  const toolCall: ToolCall = {
                    tool: part.tool,
                    input: getToolInput(part),
                    error: getToolError(part),
                    status: currentStatus,
                    id: part.id,
                    state: part.state
                      ? {
                          status: getToolStatus({ state: part.state }),
                          input: part.state.input,
                        }
                      : undefined,
                  };

                  console.log(
                    `[useEvents] Tool state update session=${getEventSessionId(event) || callbacks.sessionId || "unknown"} tool=${toolCall.tool || "unknown"} id=${toolCall.id} status=${currentStatus}`,
                  );

                  if (currentStatus === "running") {
                    callbacks.onToolCall?.(toolCall);
                  } else if (
                    currentStatus === "completed" ||
                    currentStatus === "error"
                  ) {
                    callbacks.onToolCallFinished?.(toolCall);
                  }
                }
              }
            } else if (event.type === "message.part.delta") {
              cancelIdleTimer();
              const properties = (event as any).properties ?? {};
              const partId = typeof properties.partID === "string" ? properties.partID : "";
              const messageId =
                typeof properties.messageID === "string" ? properties.messageID : "";
              const field =
                typeof properties.field === "string" ? properties.field : "";
              const deltaText =
                typeof properties.delta === "string" ? properties.delta : "";
              if (!partId || !messageId || !deltaText) {
                continue;
              }
              if (field && field !== "text") {
                continue;
              }

              hasObservedAssistantActivity = true;
              const partType = partTypes.get(partId);
              const messageRole = messageRoles.get(messageId);
              const isAssistantMessage =
                messageRole === "assistant" || assistantMessageIds.has(messageId);

              if (partType === "reasoning") {
                assistantMessageIds.add(messageId);
                flushPendingUnknownTextIfKnown(messageId);
                if (!seenParts.has(partId)) {
                  callbacks.onStartThinking?.();
                  seenParts.add(partId);
                }
                callbacks.onReasoning?.(deltaText, partId);
                reasoningState.set(
                  partId,
                  (reasoningState.get(partId) || 0) + deltaText.length,
                );
              } else {
                emitOrBufferTextChunk({
                  messageId,
                  partId,
                  delta: deltaText,
                  messageRole,
                  isAssistantMessage,
                });
                textState.set(partId, (textState.get(partId) || 0) + deltaText.length);
              }
            } else if (event.type === "session.idle") {
              scheduleIdleCallback(
                !hasTerminalSessionError && hasObservedAssistantActivity,
              );
            } else if (event.type === "session.status") {
              const status = (event as any).properties?.status;
              if (status?.type === "busy") {
                cancelIdleTimer();
                hasTerminalSessionError = false;
              } else if (status?.type === "done") {
                scheduleIdleCallback(
                  !hasTerminalSessionError && hasObservedAssistantActivity,
                );
              } else if (status?.type === "idle") {
                scheduleIdleCallback(
                  !hasTerminalSessionError && hasObservedAssistantActivity,
                );
              } else if (status?.type === "retry" || status?.type === "error") {
                cancelIdleTimer();
                if (status?.type === "error") {
                  hasTerminalSessionError = true;
                }
                callbacks.onSessionError?.({
                  type: status.type,
                  message: status.message || `Session ${status.type}`,
                  attempt: status.attempt,
                  nextRetryAt: status.next,
                });
              }
            }
          } catch (error) {
            console.error("[useEvents] Error while handling event:", event, error);
            callbacks.onSessionError?.({
              type: "event_processing",
              message:
                formatErrorMessage(error, "Failed to process session event") ||
                "Failed to process session event",
            });
          }
        }
      } catch (error) {
        console.error("[useEvents] Error in event stream:", error);
        callbacks.onSessionError?.({
          type: "stream",
          message:
            formatErrorMessage(error, "Event stream disconnected") ||
            "Event stream disconnected",
        });
      }
    })();
  };

  const stop = () => {
    isActive = false;
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    cancelIdleTimer();
  };

  return { start, stop };
}

function getToolStatus(part: any): ToolStatus | undefined {
  const status = part?.state?.status ?? part?.status;
  if (status === "running" || status === "completed" || status === "error") {
    return status;
  }
  return undefined;
}

function getToolInput(part: any): unknown {
  return part?.state?.input ?? part?.input;
}

function getToolError(part: any): string | undefined {
  const candidates = [
    part?.state?.error,
    part?.error,
    part?.state?.output?.error,
    part?.output?.error,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const message = formatErrorMessage(candidate, undefined);
    if (message) return message;
  }
  return undefined;
}

function formatErrorMessage(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (value == null) return fallback;
  if (value instanceof Error) {
    return value.message || fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedCandidates = [
      record.message,
      record.error,
      record.reason,
      record.detail,
    ];
    for (const candidate of nestedCandidates) {
      const nested = formatErrorMessage(candidate);
      if (nested) return nested;
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore serialization errors.
    }
  }
  return fallback;
}

function getEncryptedToolMarkers(part: any): string[] {
  const details = part?.metadata?.openrouter?.reasoning_details;
  if (!Array.isArray(details)) return [];
  return details.flatMap((entry: any) => {
    if (!entry || entry.type !== "reasoning.encrypted") return [];
    if (typeof entry.id !== "string" || entry.id.trim().length === 0) return [];
    return [entry.id.trim()];
  });
}

function summarizeEvent(event: any): Record<string, unknown> {
  const type = typeof event?.type === "string" ? event.type : "unknown";
  const properties = event?.properties ?? {};
  const summary: Record<string, unknown> = {
    type,
    sessionID: getEventSessionId(event) || undefined,
  };

  if (type === "message.updated") {
    summary.messageID = properties?.info?.id;
    summary.role = properties?.info?.role;
    return summary;
  }

  if (type === "message.part.updated") {
    const part = properties?.part ?? {};
    summary.partID = part.id;
    summary.messageID = part.messageID;
    summary.partType = part.type;
    if (typeof properties?.delta === "string") {
      summary.deltaLength = properties.delta.length;
    }

    if (part.type === "reasoning" || part.type === "text") {
      summary.textLength = typeof part.text === "string" ? part.text.length : 0;
    }

    if (part.type === "tool") {
      summary.tool = part.tool;
      summary.toolStatus = getToolStatus(part) ?? "unknown";
    }

    const encryptedToolMarkers = getEncryptedToolMarkers(part);
    if (encryptedToolMarkers.length > 0) {
      summary.encryptedToolMarkers = encryptedToolMarkers.slice(0, 5);
    }
    return summary;
  }

  if (type === "message.part.delta") {
    summary.partID = properties?.partID;
    summary.messageID = properties?.messageID;
    summary.field = properties?.field;
    if (typeof properties?.delta === "string") {
      summary.deltaLength = properties.delta.length;
    }
    return summary;
  }

  if (type === "session.status") {
    const status = properties?.status ?? {};
    summary.status = status?.type;
    if (status?.attempt !== undefined) summary.attempt = status.attempt;
    if (typeof status?.message === "string" && status.message.trim().length > 0) {
      summary.message = status.message;
    }
    return summary;
  }

  return summary;
}

function getEventSessionId(event: any): string | null {
  try {
    if (!event) return null;

    if (event.properties?.sessionID) return event.properties.sessionID;
    if (event.properties?.sessionId) return event.properties.sessionId;

    if (event.properties?.part?.sessionID) return event.properties.part.sessionID;
    if (event.properties?.part?.sessionId) return event.properties.part.sessionId;

    return null;
  } catch {
    return null;
  }
}
