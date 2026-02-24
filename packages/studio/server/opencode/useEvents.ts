import { OpencodeClient } from "@opencode-ai/sdk";

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
type ToolStatus = "running" | "completed" | "error";

export function useEvents(client: OpencodeClient, callbacks: EventCallbacks = {}) {
  let isActive = true;
  let lastEvent: any = null;
  let lastEventTime: number = Date.now();
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const resetInactivityTimer = () => {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(() => {
      if (isActive && lastEvent) {
        console.warn(
          `[useEvents] No events received for ${
            INACTIVITY_TIMEOUT_MS / 1000
          }s. Last event:`,
          JSON.stringify(lastEvent, null, 2),
        );
        console.warn(
          `[useEvents] Last event was at: ${new Date(
            lastEventTime,
          ).toISOString()}`,
        );
      }
    }, INACTIVITY_TIMEOUT_MS);
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
        const assistantMessageIds = new Set<string>();
        let hasObservedSessionActivity = false;

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
              const { info } = (event as any).properties;
              if (info?.role === "assistant") {
                assistantMessageIds.add(info.id);
              }
            }

            if (event.type === "message.part.updated") {
              const { part } = (event as any).properties;
              const isAssistantMessage = assistantMessageIds.has(part.messageID);
              hasObservedSessionActivity = true;

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
                // Reasoning parts can arrive before the corresponding assistant message
                // has been seen via `message.updated`. We still want to stream them so
                // the UI can show thought blocks during generation.

                if (!seenParts.has(part.id)) {
                  callbacks.onStartThinking?.();
                  seenParts.add(part.id);
                }

                const text = part.text || "";
                const lastLength = reasoningState.get(part.id) || 0;
                if (text.length > lastLength) {
                  const newContent = text.slice(lastLength);
                  callbacks.onReasoning?.(newContent, part.id);
                  reasoningState.set(part.id, text.length);
                }
              } else if (part.type === "text") {
                if (!isAssistantMessage) continue;

                const text = part.text || "";
                const lastLength = textState.get(part.id) || 0;
                if (text.length > lastLength) {
                  const newContent = text.slice(lastLength);
                  callbacks.onText?.(newContent, part.id);
                  textState.set(part.id, text.length);
                }
              } else if (part.type === "tool") {
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
            } else if (event.type === "session.idle") {
              if (!hasObservedSessionActivity) {
                continue;
              }
              callbacks.onIdle?.();
            } else if (event.type === "session.status") {
              const status = (event as any).properties?.status;
              if (status?.type === "busy") {
                hasObservedSessionActivity = true;
              } else if (status?.type === "idle") {
                if (!hasObservedSessionActivity) {
                  continue;
                }
                callbacks.onIdle?.();
              } else if (status?.type === "retry" || status?.type === "error") {
                hasObservedSessionActivity = true;
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
              message: formatErrorMessage(error, "Failed to process session event"),
            });
          }
        }
      } catch (error) {
        console.error("[useEvents] Error in event stream:", error);
        callbacks.onSessionError?.({
          type: "stream",
          message: formatErrorMessage(error, "Event stream disconnected"),
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
    const message = formatErrorMessage(candidate);
    if (message) return message;
  }
  return undefined;
}

function formatErrorMessage(
  value: unknown,
  fallback = "Unknown error",
): string | undefined {
  if (value == null) return undefined;
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
