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

export interface EventCallbacks {
  onEvent?: (event: any) => void;
  onStartThinking?: () => void;
  onReasoning?: (content: string, partId: string) => void;
  onText?: (content: string, partId: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolCallFinished?: (toolCall: ToolCall) => void;
}

// TODO: Clean this up, and make sure the callbacks are correct
export function useEvents(
  client: OpencodeClient,
  callbacks: EventCallbacks = {}
) {
  let isActive = true;

  const start = async () => {
    const events = await client.event.subscribe();

    (async () => {
      try {
        const seenParts = new Set<string>();
        const toolStates = new Map<string, string>();
        const reasoningState = new Map<string, number>();
        const textState = new Map<string, number>();

        for await (const event of events.stream) {
          if (!isActive) break;

          if (callbacks.onEvent) {
            callbacks.onEvent(event);
          }

          if (event.type === "message.part.updated") {
            const { part } = event.properties;

            if (part.type === "reasoning") {
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
    },
  };
}
