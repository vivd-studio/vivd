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
  | "session.completed"
  | "session.error"
  | "usage.updated";

export interface AgentEventInput {
  type: AgentEventType;
  sessionId: string;
  timestamp: number;
  data: AgentEventData;
}

export interface AgentEvent extends AgentEventInput {
  eventId: string;
  sequence: number;
}

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "done" }
  | { type: "retry"; attempt?: number; message?: string; next?: number };

export type AgentEventData =
  | ThinkingStartedData
  | ReasoningDeltaData
  | MessageDeltaData
  | ToolStartedData
  | ToolCompletedData
  | ToolErrorData
  | MessageUpdatedData
  | SessionCompletedData
  | SessionErrorData
  | UsageUpdatedData;

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

export interface SessionErrorData {
  kind: "session.error";
  errorType: string; // 'retry', 'error', 'quota', etc.
  message: string;
  attempt?: number;
  nextRetryAt?: number; // Unix timestamp in ms for next retry
}

export interface UsageUpdatedData {
  kind: "usage.updated";
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

/**
 * Event emitter for agent session events.
 * Allows multiple subscribers to listen for events from a specific session.
 * Buffers events per session to handle late subscribers.
 */
class AgentEventEmitter extends EventEmitter {
  private static instance: AgentEventEmitter;
  private sessionBuffers: Map<string, AgentEvent[]> = new Map();
  private sessionSequences: Map<string, number> = new Map();
  private sessionStatuses: Map<string, SessionStatus> = new Map();
  private sessionStatusUpdatedAt: Map<string, number> = new Map();
  private completedSessions: Set<string> = new Set();
  private static readonly BUFFER_CLEANUP_DELAY_MS = 5 * 60 * 1000;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  static getInstance(): AgentEventEmitter {
    if (!AgentEventEmitter.instance) {
      AgentEventEmitter.instance = new AgentEventEmitter();
    }
    return AgentEventEmitter.instance;
  }

  emitSessionEvent(sessionId: string, event: AgentEventInput): void {
    const sequence = this.nextSequence(sessionId);
    const eventId = this.getEventId(sessionId, sequence);
    const eventWithMeta: AgentEvent = {
      ...event,
      eventId,
      sequence,
    };

    this.updateSessionStatus(sessionId, eventWithMeta);

    if (!this.sessionBuffers.has(sessionId)) {
      this.sessionBuffers.set(sessionId, []);
    }
    this.sessionBuffers.get(sessionId)!.push(eventWithMeta);

    if (event.type === "session.completed") {
      this.completedSessions.add(sessionId);
      setTimeout(() => {
        this.cleanupSession(sessionId);
      }, AgentEventEmitter.BUFFER_CLEANUP_DELAY_MS);
    }

    this.emit(`session:${sessionId}`, eventWithMeta);
  }

  private cleanupSession(sessionId: string): void {
    this.sessionBuffers.delete(sessionId);
    this.completedSessions.delete(sessionId);
  }

  getBufferedEvents(sessionId: string): AgentEvent[] {
    return this.sessionBuffers.get(sessionId) || [];
  }

  isSessionCompleted(sessionId: string): boolean {
    return this.completedSessions.has(sessionId);
  }

  subscribeToSession(
    sessionId: string,
    callback: (event: AgentEvent) => void,
  ): () => void {
    const eventName = `session:${sessionId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }

  async *createSessionStream(
    sessionId: string,
    signal?: AbortSignal,
    lastEventId?: string,
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

    const bufferedEvents = this.getBufferedEvents(sessionId);
    let startIndex = 0;
    if (lastEventId) {
      const lastIndex = bufferedEvents.findIndex(
        (event) => event.eventId === lastEventId,
      );
      if (lastIndex >= 0) {
        startIndex = lastIndex + 1;
      }
    }
    const replayEvents = bufferedEvents.slice(startIndex);
    const maxReplaySequence =
      replayEvents.length > 0 ? replayEvents[replayEvents.length - 1].sequence : 0;

    for (const event of replayEvents) {
      yield event;
    }

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
          const nextEvent = queue.shift()!;
          // Avoid duplicates when an event was emitted between subscribe() and
          // buffered replay initialization; those events can exist in both sources.
          if (nextEvent.sequence <= maxReplaySequence) {
            continue;
          }
          yield nextEvent;
        } else {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }

      while (queue.length > 0) {
        const nextEvent = queue.shift()!;
        if (nextEvent.sequence <= maxReplaySequence) {
          continue;
        }
        yield nextEvent;
      }
    } finally {
      unsubscribe();
      signal?.removeEventListener("abort", abortHandler);
    }
  }

  setSessionStatus(sessionId: string, status: SessionStatus): void {
    if (status.type === "idle") {
      this.sessionStatuses.delete(sessionId);
      this.sessionStatusUpdatedAt.delete(sessionId);
      return;
    }
    this.sessionStatuses.set(sessionId, status);
    this.sessionStatusUpdatedAt.set(sessionId, Date.now());
  }

  getSessionStatuses(): Record<string, SessionStatus> {
    return Object.fromEntries(this.sessionStatuses.entries());
  }

  getSessionStatusSnapshots(): Record<
    string,
    { status: SessionStatus; updatedAt: number }
  > {
    const snapshots: Record<
      string,
      { status: SessionStatus; updatedAt: number }
    > = {};
    for (const [sessionId, status] of this.sessionStatuses.entries()) {
      snapshots[sessionId] = {
        status,
        updatedAt: this.sessionStatusUpdatedAt.get(sessionId) ?? 0,
      };
    }
    return snapshots;
  }

  private nextSequence(sessionId: string): number {
    const next = (this.sessionSequences.get(sessionId) ?? 0) + 1;
    this.sessionSequences.set(sessionId, next);
    return next;
  }

  private getEventId(sessionId: string, sequence: number): string {
    return `${sessionId}:${sequence}`;
  }

  private updateSessionStatus(sessionId: string, event: AgentEvent): void {
    if (event.type === "session.completed") {
      this.sessionStatuses.delete(sessionId);
      this.sessionStatusUpdatedAt.delete(sessionId);
      return;
    }

    if (event.type === "session.error") {
      const data = event.data as SessionErrorData;
      this.sessionStatuses.set(sessionId, {
        type: "retry",
        attempt: data.attempt,
        message: data.message,
        next: data.nextRetryAt,
      });
      this.sessionStatusUpdatedAt.set(sessionId, Date.now());
      return;
    }

    this.sessionStatuses.set(sessionId, { type: "busy" });
    this.sessionStatusUpdatedAt.set(sessionId, Date.now());
  }
}

export const agentEventEmitter = AgentEventEmitter.getInstance();

export function createAgentEvent(
  sessionId: string,
  type: AgentEventType,
  data: AgentEventData,
): AgentEventInput {
  return {
    type,
    sessionId,
    timestamp: Date.now(),
    data,
  };
}
