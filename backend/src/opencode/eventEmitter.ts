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
 * Buffers events per session to handle late subscribers (race condition fix).
 */
class AgentEventEmitter extends EventEmitter {
  private static instance: AgentEventEmitter;
  // Buffer events per session for late subscribers
  private sessionBuffers: Map<string, AgentEvent[]> = new Map();
  // Track which sessions are complete to know when to clean up
  private completedSessions: Set<string> = new Set();
  // Cleanup timeout for completed sessions (5 minutes)
  private static readonly BUFFER_CLEANUP_DELAY_MS = 5 * 60 * 1000;

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
   * Emit an event for a specific session.
   * Also buffers the event for late subscribers.
   */
  emitSessionEvent(sessionId: string, event: AgentEvent): void {
    // Buffer the event
    if (!this.sessionBuffers.has(sessionId)) {
      this.sessionBuffers.set(sessionId, []);
    }
    this.sessionBuffers.get(sessionId)!.push(event);

    // Mark session as complete and schedule cleanup
    if (event.type === "session.completed") {
      this.completedSessions.add(sessionId);
      setTimeout(() => {
        this.cleanupSession(sessionId);
      }, AgentEventEmitter.BUFFER_CLEANUP_DELAY_MS);
    }

    this.emit(`session:${sessionId}`, event);
  }

  /**
   * Clean up buffered events for a session
   */
  private cleanupSession(sessionId: string): void {
    this.sessionBuffers.delete(sessionId);
    this.completedSessions.delete(sessionId);
  }

  /**
   * Get buffered events for a session (for late subscribers)
   */
  getBufferedEvents(sessionId: string): AgentEvent[] {
    return this.sessionBuffers.get(sessionId) || [];
  }

  /**
   * Check if a session has completed
   */
  isSessionCompleted(sessionId: string): boolean {
    return this.completedSessions.has(sessionId);
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
   * Replays buffered events first, then yields new events.
   */
  async *createSessionStream(
    sessionId: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const queue: AgentEvent[] = [];
    let resolve: (() => void) | null = null;
    let isAborted = false;
    let sessionCompleted = false;

    // First, replay any buffered events (handles late subscriber race condition)
    const bufferedEvents = this.getBufferedEvents(sessionId);
    for (const event of bufferedEvents) {
      if (event.type === "session.completed") {
        sessionCompleted = true;
      }
      yield event;
    }

    // If session already completed, we're done
    if (sessionCompleted) {
      return;
    }

    const unsubscribe = this.subscribeToSession(sessionId, (event) => {
      // Skip events we already yielded from buffer
      const alreadyYielded = bufferedEvents.some(
        (e) => e.timestamp === event.timestamp && e.type === event.type
      );
      if (alreadyYielded) {
        return;
      }

      queue.push(event);
      if (event.type === "session.completed") {
        sessionCompleted = true;
      }
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
      while (!isAborted && !sessionCompleted) {
        if (queue.length > 0) {
          const event = queue.shift()!;
          yield event;
        } else {
          // Wait for next event
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }
      // Drain remaining events
      while (queue.length > 0) {
        yield queue.shift()!;
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
