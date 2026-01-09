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

// Inactivity timeout in milliseconds (1 minute)
const INACTIVITY_TIMEOUT_MS = 60 * 1000;

// TODO: Clean this up, and make sure the callbacks are correct
export function useEvents(
  client: OpencodeClient,
  callbacks: EventCallbacks = {}
) {
  let isActive = true;
  let lastEvent: any = null;
  let lastEventTime: number = Date.now();
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  // Reset the inactivity timer on each event
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
          JSON.stringify(lastEvent, null, 2)
        );
        console.warn(
          `[useEvents] Last event was at: ${new Date(
            lastEventTime
          ).toISOString()}`
        );
      }
    }, INACTIVITY_TIMEOUT_MS);
  };

  const start = async () => {
    const events = await client.event.subscribe();
    const filterSessionId = callbacks.sessionId;

    // Start the inactivity timer
    resetInactivityTimer();

    (async () => {
      try {
        const seenParts = new Set<string>();
        const toolStates = new Map<string, string>();
        const reasoningState = new Map<string, number>();
        const textState = new Map<string, number>();
        // Track which messages are assistant messages (not user messages)
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

          // Track latest event for debugging
          lastEvent = event;
          lastEventTime = Date.now();
          resetInactivityTimer();

          if (callbacks.onEvent) {
            callbacks.onEvent(event);
          }

          // Track message roles from message.updated events
          if (event.type === "message.updated") {
            const { info } = (event as any).properties;
            if (info?.role === "assistant") {
              assistantMessageIds.add(info.id);

              if (
                info.cost !== undefined &&
                info.tokens &&
                callbacks.onUsageUpdated
              ) {
                callbacks.onUsageUpdated({
                  cost: info.cost,
                  tokens: info.tokens,
                });
              }
            }
          }

          if (event.type === "message.part.updated") {
            const { part } = (event as any).properties;

            // Only process parts from assistant messages for text/reasoning
            // User messages should not emit text deltas to the streaming UI
            const isAssistantMessage = assistantMessageIds.has(part.messageID);

            // Handle step-finish for usage updates
            if (part.type === "step-finish") {
              if (
                part.cost !== undefined &&
                part.tokens &&
                callbacks.onUsageUpdated
              ) {
                callbacks.onUsageUpdated({
                  cost: part.cost,
                  tokens: part.tokens,
                });
              }
            } else if (part.type === "reasoning") {
              // Reasoning parts are only from assistant messages, but double-check
              if (!isAssistantMessage) continue;

              if (!seenParts.has(part.id)) {
                if (callbacks.onStartThinking) {
                  callbacks.onStartThinking();
                }
                seenParts.add(part.id);
              }

              const text = part.text || "";
              const lastLength = reasoningState.get(part.id) || 0;
              if (text.length > lastLength) {
                const newContent = text.slice(lastLength);
                if (callbacks.onReasoning) {
                  callbacks.onReasoning(newContent, part.id);
                }
                reasoningState.set(part.id, text.length);
              }
            } else if (part.type === "text") {
              // Skip text parts from user messages - they would echo the user's prompt
              if (!isAssistantMessage) continue;

              const text = part.text || "";
              const lastLength = textState.get(part.id) || 0;
              if (text.length > lastLength) {
                const newContent = text.slice(lastLength);
                if (callbacks.onText) {
                  callbacks.onText(newContent, part.id);
                }
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
                  if (callbacks.onToolCall) {
                    callbacks.onToolCall(toolCall);
                  }
                } else if (
                  currentStatus === "completed" ||
                  currentStatus === "error"
                ) {
                  if (callbacks.onToolCallFinished) {
                    callbacks.onToolCallFinished(toolCall);
                  }
                }
              }
            }
          } else if (event.type === "session.idle") {
            // Skip early idle events - a fresh session will emit idle before work starts
            if (eventCount <= 2) {
              console.log(
                `[useEvents] Ignoring early session.idle (eventCount=${eventCount}) - waiting for actual work to complete`
              );
              continue;
            }
            if (callbacks.onIdle) {
              callbacks.onIdle();
            }
          } else if (event.type === "session.status") {
            const status = (event as any).properties?.status;
            if (status?.type === "idle") {
              // Skip early idle status - a fresh session will emit idle before work starts
              if (eventCount <= 2) {
                console.log(
                  `[useEvents] Ignoring early session.status idle (eventCount=${eventCount}) - waiting for actual work to complete`
                );
                continue;
              }
              if (callbacks.onIdle) {
                callbacks.onIdle();
              }
            } else if (status?.type === "retry" || status?.type === "error") {
              // Handle retry/error status (e.g., quota exceeded)
              console.warn(
                `[useEvents] Session status ${status.type}: ${status.message}`
              );
              if (callbacks.onSessionError) {
                callbacks.onSessionError({
                  type: status.type,
                  message: status.message || `Session ${status.type}`,
                  attempt: status.attempt,
                  nextRetryAt: status.next, // 'next' is the field from OpenCode SDK
                });
              }
            }
          }
        }
      } catch (e) {
        if (isActive) console.error("Stream closed", e);
      }
    })();
  };

  return {
    start,
    stop: () => {
      isActive = false;
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    },
  };
}

function getEventSessionId(event: any): string | undefined {
  const props = event?.properties;
  if (!props) return undefined;
  if (props.sessionID) return props.sessionID as string;
  if (props.sessionId) return props.sessionId as string;
  if (props.info?.sessionID) return props.info.sessionID as string;
  if (props.part?.sessionID) return props.part.sessionID as string;
  return undefined;
}
