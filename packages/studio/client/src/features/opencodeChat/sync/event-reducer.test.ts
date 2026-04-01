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
      questions: [
        {
          id: "que-1",
          sessionID: "sess-1",
          questions: [],
        },
      ],
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
    expect(next.questionRequestsBySessionId["sess-1"]?.map((request) => request.id))
      .toEqual(["que-1"]);
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

  it("buffers text deltas that arrive before the corresponding part update and merges them once the part exists", () => {
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
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "Hello",
          },
        },
        {
          eventId: "evt-3",
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              messageID: "msg-1",
              type: "text",
              text: "",
            },
          },
        },
      ],
    });

    expect(selectMessagesForSession(next, "sess-1")[0]?.parts[0]?.text).toBe(
      "Hello",
    );
  });

  it("does not duplicate a buffered text delta when the later part update already includes that prefix", () => {
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
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "Hello",
          },
        },
        {
          eventId: "evt-3",
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              messageID: "msg-1",
              type: "text",
              text: "Hello world",
            },
          },
        },
      ],
    });

    expect(selectMessagesForSession(next, "sess-1")[0]?.parts[0]?.text).toBe(
      "Hello world",
    );
  });

  it("marks refresh required across a bridge reconnect cycle", () => {
    const reconnecting = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "event.received",
      payload: {
        eventId: "evt-1",
        type: "bridge.status",
        properties: {
          state: "reconnecting",
          message: "stream lost",
        },
      },
    });

    expect(reconnecting.connection.state).toBe("reconnecting");
    expect(reconnecting.refreshGeneration).toBe(1);

    const connected = openCodeChatReducer(reconnecting, {
      type: "event.received",
      payload: {
        eventId: "evt-2",
        type: "bridge.status",
        properties: {
          state: "connected",
        },
      },
    });

    expect(connected.connection.state).toBe("connected");
    expect(connected.refreshGeneration).toBe(1);
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

  it("preserves already-seen active session messages when a refresh snapshot lags behind", () => {
    const activeState = openCodeChatReducer(
      openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
        type: "event.received",
        payload: {
          type: "session.status",
          properties: {
            sessionID: "sess-1",
            status: { type: "busy" },
          },
        },
      }),
      {
        type: "events.receivedBatch",
        payload: [
          {
            type: "message.updated",
            properties: {
              info: {
                id: "msg-1",
                sessionID: "sess-1",
                role: "assistant",
                time: { created: 100, completed: 200 },
              },
            },
          },
          {
            type: "message.part.updated",
            properties: {
              part: {
                id: "part-1",
                messageID: "msg-1",
                type: "text",
                text: "already seen",
              },
            },
          },
          {
            type: "message.updated",
            properties: {
              info: {
                id: "msg-2",
                sessionID: "sess-1",
                role: "assistant",
                time: { created: 300 },
              },
            },
          },
          {
            type: "message.part.updated",
            properties: {
              part: {
                id: "part-2",
                messageID: "msg-2",
                type: "text",
                text: "latest live step",
              },
            },
          },
        ],
      },
    );

    const refreshed = openCodeChatReducer(activeState, {
      type: "session.messages.loaded",
      payload: {
        sessionId: "sess-1",
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
                text: "already seen",
              },
            ],
          },
        ],
      },
    });

    expect(selectMessagesForSession(refreshed, "sess-1").map((message) => message.id))
      .toEqual(["msg-1", "msg-2"]);
    expect(selectMessagesForSession(refreshed, "sess-1")[1]?.parts[0]?.text).toBe(
      "latest live step",
    );
  });

  it("reconciles bootstrap refreshes without wiping active session transcript state", () => {
    const activeState = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: {
        sessions: [{ id: "sess-1", time: { updated: 20 } }],
        statuses: {
          "sess-1": { type: "busy" },
        },
        questions: [],
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
                text: "first step",
              },
            ],
          },
          {
            info: {
              id: "msg-2",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 200 },
            },
            parts: [
              {
                id: "part-2",
                messageID: "msg-2",
                type: "text",
                text: "second step",
              },
            ],
          },
        ],
      },
    });

    const refreshed = openCodeChatReducer(activeState, {
      type: "bootstrap.refreshed",
      payload: {
        sessions: [{ id: "sess-1", time: { updated: 30 } }],
        statuses: {
          "sess-1": { type: "busy" },
        },
        questions: [],
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
                text: "first step",
              },
            ],
          },
        ],
      },
    });

    expect(selectMessagesForSession(refreshed, "sess-1").map((message) => message.id))
      .toEqual(["msg-1", "msg-2"]);
    expect(refreshed.sessionStatusById["sess-1"]).toEqual({ type: "busy" });
  });

  it("preserves already-seen terminal session messages when a later refresh snapshot lags behind", () => {
    const completedState = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: {
        sessions: [{ id: "sess-1", time: { updated: 40 } }],
        statuses: {
          "sess-1": { type: "done" },
        },
        questions: [],
        messages: [
          {
            info: {
              id: "msg-1",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 100, completed: 200 },
            },
            parts: [
              {
                id: "part-1",
                messageID: "msg-1",
                type: "text",
                text: "first visible action",
              },
            ],
          },
          {
            info: {
              id: "msg-2",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 300, completed: 400 },
            },
            parts: [
              {
                id: "part-2",
                messageID: "msg-2",
                type: "text",
                text: "second visible action",
              },
            ],
          },
        ],
      },
    });

    const refreshed = openCodeChatReducer(completedState, {
      type: "session.messages.loaded",
      payload: {
        sessionId: "sess-1",
        messages: [
          {
            info: {
              id: "msg-1",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 100, completed: 200 },
            },
            parts: [
              {
                id: "part-1",
                messageID: "msg-1",
                type: "text",
                text: "first visible action",
              },
            ],
          },
        ],
      },
    });

    expect(selectMessagesForSession(refreshed, "sess-1").map((message) => message.id))
      .toEqual(["msg-1", "msg-2"]);
  });

  it("preserves already-seen terminal session parts when a bootstrap refresh snapshot shrinks a message", () => {
    const completedState = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: {
        sessions: [{ id: "sess-1", time: { updated: 40 } }],
        statuses: {
          "sess-1": { type: "done" },
        },
        questions: [],
        messages: [
          {
            info: {
              id: "msg-1",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 100, completed: 200 },
            },
            parts: [
              {
                id: "part-1",
                messageID: "msg-1",
                type: "text",
                text: "I inspected the project structure and starter files",
              },
              {
                id: "part-2",
                messageID: "msg-1",
                type: "text",
                text: "Listed src/pages, src/layouts, and src/styles",
              },
            ],
          },
        ],
      },
    });

    const refreshed = openCodeChatReducer(completedState, {
      type: "bootstrap.refreshed",
      payload: {
        sessions: [{ id: "sess-1", time: { updated: 50 } }],
        statuses: {
          "sess-1": { type: "done" },
        },
        questions: [],
        messages: [
          {
            info: {
              id: "msg-1",
              sessionID: "sess-1",
              role: "assistant",
              time: { created: 100, completed: 200 },
            },
            parts: [
              {
                id: "part-1",
                messageID: "msg-1",
                type: "text",
                text: "I inspected the project structure",
              },
            ],
          },
        ],
      },
    });

    expect(selectMessagesForSession(refreshed, "sess-1")[0]?.parts).toEqual([
      {
        id: "part-1",
        messageID: "msg-1",
        type: "text",
        text: "I inspected the project structure and starter files",
      },
      {
        id: "part-2",
        messageID: "msg-1",
        type: "text",
        text: "Listed src/pages, src/layouts, and src/styles",
      },
    ]);
  });

  it("removes messages and parts when canonical removal events arrive", () => {
    const bootstrapped = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: {
        sessions: [],
        statuses: {},
        questions: [],
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

  it("tracks question request lifecycle events", () => {
    const asked = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "event.received",
      payload: {
        type: "question.asked",
        properties: {
          id: "que-2",
          sessionID: "sess-1",
          questions: [{ header: "A", question: "Pick one", options: [] }],
        },
      },
    });

    expect(asked.questionRequestsBySessionId["sess-1"]?.map((request) => request.id))
      .toEqual(["que-2"]);

    const replied = openCodeChatReducer(asked, {
      type: "event.received",
      payload: {
        type: "question.replied",
        properties: {
          sessionID: "sess-1",
          requestID: "que-2",
        },
      },
    });

    expect(replied.questionRequestsBySessionId["sess-1"]).toBeUndefined();
  });

  it("cleans cached session state when a session is deleted", () => {
    const bootstrapped = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: {
        sessions: [{ id: "sess-1", title: "Session 1", time: { updated: 100 } }],
        statuses: {
          "sess-1": { type: "busy" },
        },
        questions: [
          {
            id: "que-1",
            sessionID: "sess-1",
            questions: [],
          },
        ],
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

    const deleted = openCodeChatReducer(bootstrapped, {
      type: "event.received",
      payload: {
        type: "session.deleted",
        properties: {
          info: {
            id: "sess-1",
          },
        },
      },
    });

    expect(selectSessions(deleted)).toEqual([]);
    expect(selectMessagesForSession(deleted, "sess-1")).toEqual([]);
    expect(deleted.messagesById["msg-1"]).toBeUndefined();
    expect(deleted.partsByMessageId["msg-1"]).toBeUndefined();
    expect(deleted.messagesBySessionId["sess-1"]).toBeUndefined();
    expect(deleted.sessionStatusById["sess-1"]).toBeUndefined();
    expect(deleted.questionRequestsBySessionId["sess-1"]).toBeUndefined();
  });

  it("treats archived session updates as removals and clears cached session state", () => {
    const bootstrapped = openCodeChatReducer(OPEN_CODE_CHAT_INITIAL_STATE, {
      type: "bootstrap.loaded",
      payload: {
        sessions: [{ id: "sess-1", title: "Session 1", time: { updated: 100 } }],
        statuses: {
          "sess-1": { type: "done" },
        },
        questions: [
          {
            id: "que-1",
            sessionID: "sess-1",
            questions: [],
          },
        ],
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

    const archived = openCodeChatReducer(bootstrapped, {
      type: "event.received",
      payload: {
        type: "session.updated",
        properties: {
          info: {
            id: "sess-1",
            time: { archived: 123 },
          },
        },
      },
    });

    expect(selectSessions(archived)).toEqual([]);
    expect(selectMessagesForSession(archived, "sess-1")).toEqual([]);
    expect(archived.messagesById["msg-1"]).toBeUndefined();
    expect(archived.partsByMessageId["msg-1"]).toBeUndefined();
    expect(archived.sessionStatusById["sess-1"]).toBeUndefined();
    expect(archived.questionRequestsBySessionId["sess-1"]).toBeUndefined();
  });
});
