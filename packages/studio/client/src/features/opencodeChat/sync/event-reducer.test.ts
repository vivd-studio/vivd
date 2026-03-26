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
