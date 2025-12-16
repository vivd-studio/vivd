import { EventEmitter } from "events";

// Event types that can be sent to the frontend
export type AgentEventType =
  | "thinking.started"
  | "reasoning.delta"
  | "message.delta"
  | "tool.started"
  | "tool.completed"
  | "tool.error"
  | "message.updated"
  | "session.completed";

export interface AgentEvent {
  type: AgentEventType;
  sessionId: string;
  timestamp: number;
  data: AgentEventData;
}

export type AgentEventData =
  | ThinkingStartedData
  | ReasoningDeltaData
  | MessageDeltaData
  | ToolStartedData
  | ToolCompletedData
  | ToolErrorData
  | MessageUpdatedData
  | SessionCompletedData;

export interface ThinkingStartedData {
  kind: "thinking.started";
}

export interface ReasoningDeltaData {
  kind: "reasoning.delta";
  content: string;
  partId: string;
}

export interface MessageDeltaData {
  kind: "message.delta";
  content: string;
  partId: string;
}

export interface ToolStartedData {
  kind: "tool.started";
  toolId: string;
  tool: string;
  title?: string;
  input?: unknown;
}

export interface ToolCompletedData {
  kind: "tool.completed";
  toolId: string;
  tool: string;
}

export interface ToolErrorData {
  kind: "tool.error";
  toolId: string;
  tool: string;
  error?: string;
}

export interface MessageUpdatedData {
  kind: "message.updated";
  messageId: string;
}

export interface SessionCompletedData {
  kind: "session.completed";
}

/**
 * Event emitter for agent session events.
 * Allows multiple subscribers to listen for events from a specific session.
 */
class AgentEventEmitter extends EventEmitter {
  private static instance: AgentEventEmitter;

  private constructor() {
    super();
    // Allow many listeners for multiple concurrent sessions
    this.setMaxListeners(100);
  }

  static getInstance(): AgentEventEmitter {
    if (!AgentEventEmitter.instance) {
      AgentEventEmitter.instance = new AgentEventEmitter();
    }
    return AgentEventEmitter.instance;
  }

  /**
   * Emit an event for a specific session
   */
  emitSessionEvent(sessionId: string, event: AgentEvent): void {
    this.emit(`session:${sessionId}`, event);
  }

  /**
   * Subscribe to events for a specific session
   */
  subscribeToSession(
    sessionId: string,
    callback: (event: AgentEvent) => void
  ): () => void {
    const eventName = `session:${sessionId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }

  /**
   * Create an async generator that yields events for a session.
   * This is used by tRPC subscriptions.
   */
  async *createSessionStream(
    sessionId: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const queue: AgentEvent[] = [];
    let resolve: (() => void) | null = null;
    let isAborted = false;

    const unsubscribe = this.subscribeToSession(sessionId, (event) => {
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    const abortHandler = () => {
      isAborted = true;
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    signal?.addEventListener("abort", abortHandler);

    try {
      while (!isAborted) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          // Wait for next event
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }
    } finally {
      unsubscribe();
      signal?.removeEventListener("abort", abortHandler);
    }
  }
}

export const agentEventEmitter = AgentEventEmitter.getInstance();

/**
 * Helper to create events with proper typing
 */
export function createAgentEvent(
  sessionId: string,
  type: AgentEventType,
  data: AgentEventData
): AgentEvent {
  return {
    type,
    sessionId,
    timestamp: Date.now(),
    data,
  };
}
