import type {
  OpenCodeChatBootstrap,
  OpenCodeQuestionRequest,
  OpenCodeChatState,
  OpenCodeSessionMessageRecord,
} from "../types";
import { OPEN_CODE_CHAT_INITIAL_STATE } from "../types";
import { upsertSessionMessagesIntoState } from "./event-reducer";

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupQuestionRequestsBySession(
  questions: OpenCodeQuestionRequest[],
): Record<string, OpenCodeQuestionRequest[]> {
  const grouped: Record<string, OpenCodeQuestionRequest[]> = {};

  for (const question of questions) {
    if (!question?.id || !question.sessionID) continue;
    const current = grouped[question.sessionID] ?? [];
    current.push(question);
    grouped[question.sessionID] = current;
  }

  for (const sessionId of Object.keys(grouped)) {
    grouped[sessionId] = [...grouped[sessionId]].sort((left, right) =>
      compareStrings(left.id, right.id),
    );
  }

  return grouped;
}

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
    questionRequestsBySessionId: groupQuestionRequestsBySession(
      bootstrap.questions,
    ),
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
