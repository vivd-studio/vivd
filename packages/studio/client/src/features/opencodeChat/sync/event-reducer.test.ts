import { describe, expect, it } from "vitest";
import { openCodeChatReducer } from "./event-reducer";
import { selectMessagesForSession, selectSessions } from "./selectors";
import { OPEN_CODE_CHAT_INITIAL_STATE, type OpenCodeChatBootstrap } from "../types";

describe("openCodeChatReducer", () => {
  it("normalizes bootstrap sessions, messages, and parts", () => {
    const bootstrap: OpenCodeChatBootstrap = {
      sessions: [
        { id: "sess-1", title: "Session 1", time: { updated: 20 } },
        { id: "sess-2", title: "Session 2", time: { updated: 10 } },
      ],
      statuses: {
        "sess-1": { type: "busy" },
      },
      messages: [
        {
          info: {
            id: "msg-1",
            sessionID: "sess-1",
            role: "assistant",
            time: { created: 100 },
          },
          parts: [
            {
              id: "part-1",
              messageID: "msg-1",
              type: "text",
              text: "hello",
            },
          ],
        },
      ],
    };

    const next = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: bootstrap,
    });

    expect(selectSessions(next).map((session) => session.id)).toEqual([
      "sess-1",
      "sess-2",
    ]);
    expect(selectMessagesForSession(next, "sess-1")).toHaveLength(1);
    expect(selectMessagesForSession(next, "sess-1")[0]?.parts[0]?.text).toBe(
      "hello",
    );
  });

  it("applies canonical message and part events into the normalized store", () => {
    const afterMessage = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "event.received",
      payload: {
        eventId: "evt-1",
        type: "message.updated",
        properties: {
          info: {
            id: "msg-1",
            sessionID: "sess-1",
            role: "assistant",
            time: { created: 100 },
          },
        },
      },
    });

    const afterPart = openCodeChatReducer(afterMessage, {
      type: "event.received",
      payload: {
        eventId: "evt-2",
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-1",
            messageID: "msg-1",
            type: "text",
            text: "hel",
          },
        },
      },
    });

    const afterDelta = openCodeChatReducer(afterPart, {
      type: "event.received",
      payload: {
        eventId: "evt-3",
        type: "message.part.delta",
        properties: {
          messageID: "msg-1",
          partID: "part-1",
          field: "text",
          delta: "lo",
        },
      },
    });

    expect(afterDelta.lastEventId).toBe("evt-3");
    expect(selectMessagesForSession(afterDelta, "sess-1")[0]?.parts[0]?.text).toBe(
      "hello",
    );
  });

  it("applies canonical event batches in a single reducer step", () => {
    const next = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "events.receivedBatch",
      payload: [
        {
          eventId: "evt-1",
          type: "message.updated",
          properties: {
            info: {
              id: "msg-1",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 100 },
            },
          },
        },
        {
          eventId: "evt-2",
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              messageID: "msg-1",
              type: "text",
              text: "hel",
            },
          },
        },
        {
          eventId: "evt-3",
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "lo",
          },
        },
      ],
    });

    expect(next.lastEventId).toBe("evt-3");
    expect(selectMessagesForSession(next, "sess-1")[0]?.parts[0]?.text).toBe(
      "hello",
    );
  });

  it("replaces session messages from a bootstrap snapshot", () => {
    const withOldMessage = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "event.received",
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: "msg-old",
            sessionID: "sess-1",
            role: "assistant",
            time: { created: 50 },
          },
        },
      },
    });

    const replaced = openCodeChatReducer(withOldMessage, {
      type: "session.messages.loaded",
      payload: {
        sessionId: "sess-1",
        messages: [
          {
            info: {
              id: "msg-new",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 100 },
            },
            parts: [
              {
                id: "part-new",
                messageID: "msg-new",
                type: "text",
                text: "fresh",
              },
            ],
          },
        ],
      },
    });

    expect(selectMessagesForSession(replaced, "sess-1").map((message) => message.id))
      .toEqual(["msg-new"]);
  });

  it("removes messages and parts when canonical removal events arrive", () => {
    const bootstrapped = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: {
        sessions: [],
        statuses: {},
        messages: [
          {
            info: {
              id: "msg-1",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 100 },
            },
            parts: [
              {
                id: "part-1",
                messageID: "msg-1",
                type: "text",
                text: "hello",
              },
            ],
          },
        ],
      },
    });

    const removed = openCodeChatReducer(bootstrapped, {
      type: "event.received",
      payload: {
        type: "message.removed",
        properties: {
          sessionID: "sess-1",
          messageID: "msg-1",
        },
      },
    });

    expect(selectMessagesForSession(removed, "sess-1")).toEqual([]);
  });
});
