import type {
  OpenCodeChatBootstrap,
  OpenCodeChatState,
  OpenCodeSessionMessageRecord,
} from "../types";
import { OPEN_CODE_CHAT_INITIAL_STATE } from "../types";
import { upsertSessionMessagesIntoState } from "./event-reducer";

export function createStateFromBootstrap(
  bootstrap: OpenCodeChatBootstrap,
): OpenCodeChatState {
  const nextState: OpenCodeChatState = {
    ...OPEN_CODE_CHAT_INITIAL_STATE,
    bootstrapped: true,
    sessionsById: Object.fromEntries(
      bootstrap.sessions.map((session) => [session.id, session]),
    ),
    sessionOrder: bootstrap.sessions.map((session) => session.id),
    sessionStatusById: { ...bootstrap.statuses },
    messagesById: {},
    messagesBySessionId: {},
    partsByMessageId: {},
  };

  return upsertSessionMessagesIntoState(nextState, bootstrap.messages);
}

export function mergeSessionMessagesIntoState(
  state: OpenCodeChatState,
  sessionId: string,
  messages: OpenCodeSessionMessageRecord[],
): OpenCodeChatState {
  const withoutSessionMessages = removeSessionMessagesFromState(state, sessionId);
  return upsertSessionMessagesIntoState(withoutSessionMessages, messages);
}

function removeSessionMessagesFromState(
  state: OpenCodeChatState,
  sessionId: string,
): OpenCodeChatState {
  const existingMessageIds = state.messagesBySessionId[sessionId] ?? [];
  if (existingMessageIds.length === 0) return state;

  const messagesById = { ...state.messagesById };
  const partsByMessageId = { ...state.partsByMessageId };
  for (const messageId of existingMessageIds) {
    delete messagesById[messageId];
    delete partsByMessageId[messageId];
  }

  return {
    ...state,
    messagesById,
    partsByMessageId,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: [],
    },
  };
}
