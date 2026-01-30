import { OpencodeClient } from "@opencode-ai/sdk";

export interface ToolCall {
  tool: string;
  title?: string;
  input?: any;
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
        let eventCount = 0;

        for await (const event of events.stream) {
          eventCount++;
          if (!isActive) break;

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
              if (!isAssistantMessage) continue;

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
              const currentStatus = part.state.status as
                | "running"
                | "completed"
                | "error";
              const prevStatus = toolStates.get(part.id);

              if (currentStatus !== prevStatus) {
                toolStates.set(part.id, currentStatus);

                const toolCall: ToolCall = {
                  tool: part.tool,
                  input: part.state.input,
                  status: currentStatus,
                  id: part.id,
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
            if (eventCount <= 2) {
              continue;
            }
            callbacks.onIdle?.();
          } else if (event.type === "session.status") {
            const status = (event as any).properties?.status;
            if (status?.type === "idle") {
              if (eventCount <= 2) {
                continue;
              }
              callbacks.onIdle?.();
            } else if (status?.type === "retry" || status?.type === "error") {
              callbacks.onSessionError?.({
                type: status.type,
                message: status.message || `Session ${status.type}`,
                attempt: status.attempt,
                nextRetryAt: status.next,
              });
            }
          }
        }
      } catch (error) {
        console.error("[useEvents] Error in event stream:", error);
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

