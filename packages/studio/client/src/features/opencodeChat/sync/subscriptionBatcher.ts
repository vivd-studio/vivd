import type { CanonicalChatEvent } from "../types";

const FLUSH_FRAME_MS = 16;

type SubscriptionBatcherState = {
  queue: CanonicalChatEvent[];
  coalesced: Map<string, number>;
  staleDeltas: Set<string>;
};

type BatchDrainResult = {
  events: CanonicalChatEvent[];
};

type MessagePartUpdatedProperties = {
  part?: {
    id?: string;
    messageID?: string;
  };
};

type MessagePartDeltaProperties = {
  messageID?: string;
  partID?: string;
};

type SessionStatusProperties = {
  sessionID?: string;
};

function getCoalesceKey(event: CanonicalChatEvent): string | null {
  if (event.type === "session.status") {
    const props = (event.properties ?? {}) as SessionStatusProperties;
    return props.sessionID ? `session.status:${props.sessionID}` : null;
  }

  if (event.type === "message.part.updated") {
    const props = (event.properties ?? {}) as MessagePartUpdatedProperties;
    const part = props.part;
    if (!part?.messageID || !part?.id) {
      return null;
    }
    return `message.part.updated:${part.messageID}:${part.id}`;
  }

  return null;
}

function getDeltaKey(event: CanonicalChatEvent): string | null {
  if (event.type === "message.part.delta") {
    const props = (event.properties ?? {}) as MessagePartDeltaProperties;
    if (!props.messageID || !props.partID) {
      return null;
    }
    return `${props.messageID}:${props.partID}`;
  }

  if (event.type === "message.part.updated") {
    const props = (event.properties ?? {}) as MessagePartUpdatedProperties;
    const part = props.part;
    if (!part?.messageID || !part?.id) {
      return null;
    }
    return `${part.messageID}:${part.id}`;
  }

  return null;
}

export function createSubscriptionBatcherState(): SubscriptionBatcherState {
  return {
    queue: [],
    coalesced: new Map(),
    staleDeltas: new Set(),
  };
}

export function queueSubscriptionEvent(
  state: SubscriptionBatcherState,
  event: CanonicalChatEvent,
): void {
  const key = getCoalesceKey(event);
  if (key) {
    const existingIndex = state.coalesced.get(key);
    if (existingIndex !== undefined) {
      state.queue[existingIndex] = event;
      if (event.type === "message.part.updated") {
        const deltaKey = getDeltaKey(event);
        if (deltaKey) {
          state.staleDeltas.add(deltaKey);
        }
      }
      return;
    }
    state.coalesced.set(key, state.queue.length);
  }

  state.queue.push(event);
}

export function drainSubscriptionEvents(
  state: SubscriptionBatcherState,
): BatchDrainResult {
  if (state.queue.length === 0) {
    return { events: [] };
  }

  const queued = state.queue;
  const skipDeltas =
    state.staleDeltas.size > 0 ? new Set(state.staleDeltas) : null;

  state.queue = [];
  state.coalesced.clear();
  state.staleDeltas.clear();

  if (!skipDeltas) {
    return { events: queued };
  }

  return {
    events: queued.filter((event) => {
      if (event.type !== "message.part.delta") {
        return true;
      }
      const deltaKey = getDeltaKey(event);
      if (!deltaKey) {
        return true;
      }
      return !skipDeltas.has(deltaKey);
    }),
  };
}

export function getSubscriptionBatcherDelay(lastFlushAt: number, now = Date.now()): number {
  return Math.max(0, FLUSH_FRAME_MS - (now - lastFlushAt));
}
