import { describe, expect, it } from "vitest";
import { OPEN_CODE_CHAT_INITIAL_STATE, type OpenCodeChatState } from "../types";
import { selectMergedSessionMessages } from "./optimisticMessages";

function createState(
  overrides: Partial<OpenCodeChatState> = {},
): OpenCodeChatState {
  return {
    ...OPEN_CODE_CHAT_INITIAL_STATE,
    ...overrides,
  };
}

describe("selectMergedSessionMessages", () => {
  const BASE_TIME = 1_700_000_000_000;

  it("includes optimistic user messages for a selected session", () => {
    const state = createState();

    const messages = selectMergedSessionMessages({
      state,
      sessionId: "sess-1",
      optimisticUserMessages: [
        {
          clientId: "client-1",
          sessionId: "sess-1",
          content: "Update the hero copy",
          createdAt: BASE_TIME + 10_000,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.info.role).toBe("user");
    expect(messages[0]?.parts?.[0]?.text).toBe("Update the hero copy");
  });

  it("includes pending optimistic messages before a session exists", () => {
    const state = createState();

    const messages = selectMergedSessionMessages({
      state,
      sessionId: null,
      optimisticUserMessages: [
        {
          clientId: "client-2",
          sessionId: null,
          content: "Create a new pricing section",
          createdAt: BASE_TIME + 20_000,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.info.sessionID).toBe("__optimistic__");
  });

  it("suppresses optimistic messages once a matching canonical user message exists", () => {
    const state = createState({
      messagesById: {
        "msg-1": {
          id: "msg-1",
          sessionID: "sess-1",
          role: "user",
          time: { created: BASE_TIME + 30_000 },
        },
      },
      messagesBySessionId: {
        "sess-1": ["msg-1"],
      },
      partsByMessageId: {
        "msg-1": [
          {
            id: "part-1",
            messageID: "msg-1",
            sessionID: "sess-1",
            type: "text",
            text: "Make the headline bigger",
          },
        ],
      },
    });

    const messages = selectMergedSessionMessages({
      state,
      sessionId: "sess-1",
      optimisticUserMessages: [
        {
          clientId: "client-3",
          sessionId: "sess-1",
          content: "Make the headline bigger",
          createdAt: BASE_TIME + 30_100,
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.info.id).toBe("msg-1");
  });

  it("keeps unmatched optimistic messages ordered after older canonical messages", () => {
    const state = createState({
      messagesById: {
        "msg-2": {
          id: "msg-2",
          sessionID: "sess-2",
          role: "assistant",
          time: { created: BASE_TIME + 40_000 },
        },
      },
      messagesBySessionId: {
        "sess-2": ["msg-2"],
      },
      partsByMessageId: {
        "msg-2": [
          {
            id: "part-2",
            messageID: "msg-2",
            sessionID: "sess-2",
            type: "text",
            text: "Done.",
          },
        ],
      },
    });

    const messages = selectMergedSessionMessages({
      state,
      sessionId: "sess-2",
      optimisticUserMessages: [
        {
          clientId: "client-4",
          sessionId: "sess-2",
          content: "Try a second pass",
          createdAt: BASE_TIME + 45_000,
        },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.info.id).toBe("msg-2");
    expect(messages[1]?.info.id).toBe("optimistic:client-4");
  });
});
