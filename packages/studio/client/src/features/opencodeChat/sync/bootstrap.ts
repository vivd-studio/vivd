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

function isActiveSessionStatus(
  status: OpenCodeChatState["sessionStatusById"][string] | null | undefined,
): boolean {
  return status?.type === "busy" || status?.type === "retry";
}

function getMessageRecordActivityAt(
  message: OpenCodeSessionMessageRecord | undefined,
): number {
  const time = message?.info?.time;
  return time?.updated ?? time?.completed ?? time?.created ?? 0;
}

function getStoredMessageActivityAt(
  message: OpenCodeChatState["messagesById"][string] | undefined,
): number {
  const time = message?.time;
  return time?.updated ?? time?.completed ?? time?.created ?? 0;
}

function shouldPreserveExistingString(
  existing: string,
  incoming: string,
): boolean {
  if (!incoming && existing) {
    return true;
  }

  return (
    existing.length > incoming.length &&
    (existing.startsWith(incoming) || existing.includes(incoming))
  );
}

function snapshotShrinksExistingParts(
  state: OpenCodeChatState,
  record: OpenCodeSessionMessageRecord,
): boolean {
  const messageId = record.info?.id;
  if (!messageId) return false;

  const existingParts = state.partsByMessageId[messageId] ?? [];
  if (existingParts.length === 0) return false;

  const incomingParts = record.parts ?? [];
  if (incomingParts.length === 0) return true;

  const incomingPartIds = new Set(
    incomingParts.map((part) => part.id).filter((id): id is string => Boolean(id)),
  );

  if (existingParts.some((part) => !incomingPartIds.has(part.id))) {
    return true;
  }

  for (const incomingPart of incomingParts) {
    const existingPart = existingParts.find((part) => part.id === incomingPart.id);
    if (!existingPart) continue;

    for (const [field, existingValue] of Object.entries(existingPart)) {
      const incomingValue = incomingPart[field];
      if (
        typeof existingValue === "string" &&
        typeof incomingValue === "string" &&
        shouldPreserveExistingString(existingValue, incomingValue)
      ) {
        return true;
      }
    }
  }

  return false;
}

function shouldPreserveExistingSessionMessages(
  state: OpenCodeChatState,
  sessionId: string,
  messages: OpenCodeSessionMessageRecord[],
): boolean {
  const existingMessageIds = state.messagesBySessionId[sessionId] ?? [];
  if (existingMessageIds.length === 0) {
    return false;
  }

  if (messages.length === 0) {
    return true;
  }

  if (isActiveSessionStatus(state.sessionStatusById[sessionId])) {
    return true;
  }

  const existingMessageIdSet = new Set(existingMessageIds);
  const incomingMessageIds = messages
    .map((message) => message.info?.id)
    .filter((id): id is string => Boolean(id));
  const incomingMessageIdSet = new Set(incomingMessageIds);
  const overlappingMessageCount = incomingMessageIds.filter((id) =>
    existingMessageIdSet.has(id),
  ).length;

  const existingLatestActivityAt = existingMessageIds.reduce((latest, messageId) => {
    return Math.max(latest, getStoredMessageActivityAt(state.messagesById[messageId]));
  }, 0);
  const incomingLatestActivityAt = messages.reduce((latest, message) => {
    return Math.max(latest, getMessageRecordActivityAt(message));
  }, 0);

  if (incomingLatestActivityAt < existingLatestActivityAt) {
    return true;
  }

  if (overlappingMessageCount === 0) {
    return false;
  }

  if (existingMessageIds.some((messageId) => !incomingMessageIdSet.has(messageId))) {
    return true;
  }

  return messages.some((message) => snapshotShrinksExistingParts(state, message));
}

function replaceSessionPartsInState(
  state: OpenCodeChatState,
  sessionId: string,
  messages: OpenCodeSessionMessageRecord[],
): OpenCodeChatState {
  const withoutSessionMessages = removeSessionMessagesFromState(state, sessionId);
  return upsertSessionMessagesIntoState(withoutSessionMessages, messages);
}

export function mergeSessionMessagesIntoState(
  state: OpenCodeChatState,
  sessionId: string,
  messages: OpenCodeSessionMessageRecord[],
): OpenCodeChatState {
  if (!shouldPreserveExistingSessionMessages(state, sessionId, messages)) {
    return replaceSessionPartsInState(state, sessionId, messages);
  }

  return upsertSessionMessagesIntoState(state, messages, {
    preserveExistingParts: true,
  });
}

function removeSessionCachesFromState(
  state: OpenCodeChatState,
  sessionId: string,
): OpenCodeChatState {
  const withoutSessionMessages = removeSessionMessagesFromState(state, sessionId);
  const sessionStatusById = { ...withoutSessionMessages.sessionStatusById };
  delete sessionStatusById[sessionId];
  const questionRequestsBySessionId = {
    ...withoutSessionMessages.questionRequestsBySessionId,
  };
  delete questionRequestsBySessionId[sessionId];

  return {
    ...withoutSessionMessages,
    sessionStatusById,
    questionRequestsBySessionId,
  };
}

function groupMessagesBySessionId(
  messages: OpenCodeSessionMessageRecord[],
): Map<string, OpenCodeSessionMessageRecord[]> {
  const grouped = new Map<string, OpenCodeSessionMessageRecord[]>();
  for (const message of messages) {
    const sessionId = message.info?.sessionID;
    if (!sessionId) continue;
    const current = grouped.get(sessionId) ?? [];
    current.push(message);
    grouped.set(sessionId, current);
  }
  return grouped;
}

export function reconcileStateFromBootstrap(
  state: OpenCodeChatState,
  bootstrap: OpenCodeChatBootstrap,
): OpenCodeChatState {
  const sessionsById = Object.fromEntries(
    bootstrap.sessions.map((session) => [session.id, session]),
  );
  let nextState: OpenCodeChatState = {
    ...state,
    bootstrapped: true,
    sessionsById,
    sessionOrder: bootstrap.sessions.map((session) => session.id),
    sessionStatusById: { ...bootstrap.statuses },
    questionRequestsBySessionId: groupQuestionRequestsBySession(
      bootstrap.questions,
    ),
  };

  const validSessionIds = new Set(bootstrap.sessions.map((session) => session.id));
  for (const sessionId of Object.keys(nextState.messagesBySessionId)) {
    if (validSessionIds.has(sessionId)) {
      continue;
    }
    nextState = removeSessionCachesFromState(nextState, sessionId);
  }

  const messagesBySessionId = groupMessagesBySessionId(bootstrap.messages);
  for (const [sessionId, sessionMessages] of messagesBySessionId.entries()) {
    nextState = mergeSessionMessagesIntoState(
      nextState,
      sessionId,
      sessionMessages,
    );
  }

  return nextState;
}

function removeSessionMessagesFromState(
  state: OpenCodeChatState,
  sessionId: string,
): OpenCodeChatState {
  const existingMessageIds = state.messagesBySessionId[sessionId] ?? [];
  if (existingMessageIds.length === 0) return state;

  const messagesById = { ...state.messagesById };
  const partsByMessageId = { ...state.partsByMessageId };
  const pendingPartDeltasByMessageId = { ...state.pendingPartDeltasByMessageId };
  for (const messageId of existingMessageIds) {
    delete messagesById[messageId];
    delete partsByMessageId[messageId];
    delete pendingPartDeltasByMessageId[messageId];
  }

  return {
    ...state,
    messagesById,
    partsByMessageId,
    pendingPartDeltasByMessageId,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: [],
    },
  };
}
