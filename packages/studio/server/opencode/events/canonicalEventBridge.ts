import { EventEmitter } from "node:events";
import path from "node:path";
import { EventBuffer } from "./eventBuffer.js";
import type {
  BridgeStatusData,
  BridgeStatusState,
  CanonicalAgentEvent,
  CanonicalAgentEventInput,
} from "./canonicalEventTypes.js";

const BUFFER_LIMIT = 1500;
const BUFFER_CLEANUP_DELAY_MS = 5 * 60 * 1000;

function getEventSessionId(event: any): string | null {
  try {
    if (!event) return null;

    if (typeof event.properties?.sessionID === "string") {
      return event.properties.sessionID;
    }
    if (typeof event.properties?.sessionId === "string") {
      return event.properties.sessionId;
    }
    if (typeof event.properties?.part?.sessionID === "string") {
      return event.properties.part.sessionID;
    }
    if (typeof event.properties?.part?.sessionId === "string") {
      return event.properties.part.sessionId;
    }

    return null;
  } catch {
    return null;
  }
}

type WorkspaceState = {
  buffer: EventBuffer<CanonicalAgentEvent>;
  sequence: number;
  cleanupTimer: NodeJS.Timeout | null;
};

class CanonicalEventBridge extends EventEmitter {
  private workspaceState = new Map<string, WorkspaceState>();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  createWorkspaceKey(projectDir: string): string {
    return path.resolve(projectDir);
  }

  emitOpencodeEvent(workspaceKey: string, rawEvent: any): CanonicalAgentEvent | null {
    if (!rawEvent || typeof rawEvent.type !== "string") {
      return null;
    }

    return this.emitWorkspaceEvent({
      workspaceKey,
      sessionId: getEventSessionId(rawEvent),
      type: rawEvent.type,
      timestamp: Date.now(),
      properties: rawEvent.properties ?? {},
    });
  }

  emitBridgeStatus(
    workspaceKey: string,
    state: BridgeStatusState,
    message?: string,
  ): CanonicalAgentEvent {
    const properties: BridgeStatusData = { state };
    if (message && message.trim().length > 0) {
      properties.message = message;
    }

    return this.emitWorkspaceEvent({
      workspaceKey,
      sessionId: null,
      type: "bridge.status",
      timestamp: Date.now(),
      properties,
    });
  }

  emitWorkspaceEvent(event: CanonicalAgentEventInput): CanonicalAgentEvent {
    const workspace = this.getOrCreateWorkspaceState(event.workspaceKey);
    const nextSequence = workspace.sequence + 1;
    workspace.sequence = nextSequence;

    const emittedEvent: CanonicalAgentEvent = {
      ...event,
      eventId: `${event.workspaceKey}:${nextSequence}`,
      sequence: nextSequence,
    };

    workspace.buffer.append(emittedEvent);
    this.scheduleCleanup(event.workspaceKey);
    this.emit(this.getWorkspaceEventName(event.workspaceKey), emittedEvent);
    return emittedEvent;
  }

  async *createWorkspaceStream(
    projectDir: string,
    signal?: AbortSignal,
    lastEventId?: string,
    replayBuffered = true,
  ): AsyncGenerator<CanonicalAgentEvent, void, unknown> {
    const workspaceKey = this.createWorkspaceKey(projectDir);
    const queue: CanonicalAgentEvent[] = [];
    let resolve: (() => void) | null = null;
    let isAborted = false;

    const unsubscribe = this.subscribeToWorkspace(workspaceKey, (event) => {
      queue.push(event);
      resolve?.();
      resolve = null;
    });

    const replayEvents =
      !replayBuffered && !lastEventId
        ? []
        : this.getOrCreateWorkspaceState(workspaceKey).buffer.snapshot(lastEventId);
    const maxReplaySequence =
      replayEvents.length > 0 ? replayEvents[replayEvents.length - 1].sequence : 0;

    for (const event of replayEvents) {
      yield event;
    }

    const abortHandler = () => {
      isAborted = true;
      resolve?.();
      resolve = null;
    };
    signal?.addEventListener("abort", abortHandler);

    try {
      while (!isAborted) {
        if (queue.length > 0) {
          const nextEvent = queue.shift()!;
          if (nextEvent.sequence <= maxReplaySequence) {
            continue;
          }
          yield nextEvent;
          continue;
        }

        await new Promise<void>((resume) => {
          resolve = resume;
        });
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

  clearWorkspace(projectDir: string): void {
    const workspaceKey = this.createWorkspaceKey(projectDir);
    const state = this.workspaceState.get(workspaceKey);
    if (!state) return;

    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
    }
    this.workspaceState.delete(workspaceKey);
  }

  private subscribeToWorkspace(
    workspaceKey: string,
    callback: (event: CanonicalAgentEvent) => void,
  ): () => void {
    const eventName = this.getWorkspaceEventName(workspaceKey);
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }

  private getWorkspaceEventName(workspaceKey: string): string {
    return `workspace:${workspaceKey}`;
  }

  private getOrCreateWorkspaceState(workspaceKey: string): WorkspaceState {
    const existing = this.workspaceState.get(workspaceKey);
    if (existing) return existing;

    const created: WorkspaceState = {
      buffer: new EventBuffer<CanonicalAgentEvent>(BUFFER_LIMIT),
      sequence: 0,
      cleanupTimer: null,
    };
    this.workspaceState.set(workspaceKey, created);
    return created;
  }

  private scheduleCleanup(workspaceKey: string): void {
    const state = this.getOrCreateWorkspaceState(workspaceKey);
    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
    }

    state.cleanupTimer = setTimeout(() => {
      this.clearWorkspace(workspaceKey);
    }, BUFFER_CLEANUP_DELAY_MS);
    state.cleanupTimer.unref?.();
  }
}

export const canonicalEventBridge = new CanonicalEventBridge();
