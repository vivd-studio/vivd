import { describe, expect, it } from "vitest";
import {
  createSubscriptionBatcherState,
  drainSubscriptionEvents,
  getSubscriptionBatcherDelay,
  queueSubscriptionEvent,
} from "./subscriptionBatcher";
import type { CanonicalChatEvent } from "../types";

function createEvent(
  type: string,
  properties?: Record<string, unknown>,
): CanonicalChatEvent {
  return {
    type,
    properties,
  };
}

describe("subscriptionBatcher", () => {
  it("coalesces repeated session status events within a flush window", () => {
    const state = createSubscriptionBatcherState();

    queueSubscriptionEvent(
      state,
      createEvent("session.status", {
        sessionID: "sess-1",
        status: { type: "busy" },
      }),
    );
    queueSubscriptionEvent(
      state,
      createEvent("session.status", {
        sessionID: "sess-1",
        status: { type: "done" },
      }),
    );

    const drained = drainSubscriptionEvents(state);
    expect(drained.events).toEqual([
      createEvent("session.status", {
        sessionID: "sess-1",
        status: { type: "done" },
      }),
    ]);
  });

  it("replaces repeated part updates and drops stale deltas for that part in the same batch", () => {
    const state = createSubscriptionBatcherState();

    queueSubscriptionEvent(
      state,
      createEvent("message.part.updated", {
        part: {
          id: "part-1",
          messageID: "msg-1",
          text: "hel",
        },
      }),
    );
    queueSubscriptionEvent(
      state,
      createEvent("message.part.delta", {
        messageID: "msg-1",
        partID: "part-1",
        field: "text",
        delta: "lo",
      }),
    );
    queueSubscriptionEvent(
      state,
      createEvent("message.part.updated", {
        part: {
          id: "part-1",
          messageID: "msg-1",
          text: "hello",
        },
      }),
    );

    const drained = drainSubscriptionEvents(state);
    expect(drained.events).toEqual([
      createEvent("message.part.updated", {
        part: {
          id: "part-1",
          messageID: "msg-1",
          text: "hello",
        },
      }),
    ]);
  });

  it("computes a frame-sized delay from the last flush time", () => {
    expect(getSubscriptionBatcherDelay(100, 100)).toBe(16);
    expect(getSubscriptionBatcherDelay(100, 110)).toBe(6);
    expect(getSubscriptionBatcherDelay(100, 200)).toBe(0);
  });
});
