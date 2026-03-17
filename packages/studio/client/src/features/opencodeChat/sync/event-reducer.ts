import type {
  CanonicalChatEvent,
  OpenCodeChatAction,
  OpenCodeChatState,
  OpenCodeMessage,
  OpenCodePart,
  OpenCodeQuestionRequest,
  OpenCodeSession,
  OpenCodeSessionMessageRecord,
  OpenCodeSessionStatus,
} from "../types";
import { OPEN_CODE_CHAT_INITIAL_STATE } from "../types";
import {
  createStateFromBootstrap,
  mergeSessionMessagesIntoState,
} from "./bootstrap";

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareByTimeOrId(
  a: { id: string; time?: { created?: number; updated?: number } },
  b: { id: string; time?: { created?: number; updated?: number } },
): number {
  const aTime = a.time?.created ?? a.time?.updated ?? 0;
  const bTime = b.time?.created ?? b.time?.updated ?? 0;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  return compareStrings(a.id, b.id);
}

function sortSessionIds(sessionsById: Record<string, OpenCodeSession>): string[] {
  return Object.values(sessionsById)
    .sort((a, b) => {
      const aTime = a.time?.updated ?? a.time?.created ?? 0;
      const bTime = b.time?.updated ?? b.time?.created ?? 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return compareStrings(a.id, b.id);
    })
    .map((session) => session.id);
}

function sortMessageIds(
  messageIds: string[],
  messagesById: Record<string, OpenCodeMessage>,
): string[] {
  return [...messageIds].sort((leftId, rightId) => {
    const left = messagesById[leftId];
    const right = messagesById[rightId];
    if (!left && !right) return compareStrings(leftId, rightId);
    if (!left) return 1;
    if (!right) return -1;
    return compareByTimeOrId(left, right);
  });
}

function sortParts(parts: OpenCodePart[]): OpenCodePart[] {
  return [...parts].sort((left, right) => compareStrings(left.id, right.id));
}

function sortQuestionRequests(
  questions: OpenCodeQuestionRequest[],
): OpenCodeQuestionRequest[] {
  return [...questions].sort((left, right) => compareStrings(left.id, right.id));
}

function upsertSession(
  state: OpenCodeChatState,
  session: OpenCodeSession,
): OpenCodeChatState {
  const sessionsById = {
    ...state.sessionsById,
    [session.id]: {
      ...state.sessionsById[session.id],
      ...session,
    },
  };

  return {
    ...state,
    sessionsById,
    sessionOrder: sortSessionIds(sessionsById),
  };
}

function removeMessage(
  state: OpenCodeChatState,
  sessionId: string,
  messageId: string,
): OpenCodeChatState {
  const messageIds = state.messagesBySessionId[sessionId] ?? [];
  if (!messageIds.includes(messageId)) return state;

  const nextMessageIds = messageIds.filter((id) => id !== messageId);
  const messagesById = { ...state.messagesById };
  delete messagesById[messageId];
  const partsByMessageId = { ...state.partsByMessageId };
  delete partsByMessageId[messageId];

  return {
    ...state,
    messagesById,
    partsByMessageId,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: nextMessageIds,
    },
  };
}

function upsertMessage(
  state: OpenCodeChatState,
  message: OpenCodeMessage,
): OpenCodeChatState {
  const messagesById = {
    ...state.messagesById,
    [message.id]: {
      ...state.messagesById[message.id],
      ...message,
    },
  };
  const existingIds = state.messagesBySessionId[message.sessionID] ?? [];
  const nextIds = existingIds.includes(message.id)
    ? existingIds
    : [...existingIds, message.id];

  return {
    ...state,
    messagesById,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [message.sessionID]: sortMessageIds(nextIds, messagesById),
    },
  };
}

function upsertPart(
  state: OpenCodeChatState,
  part: OpenCodePart,
): OpenCodeChatState {
  const currentParts = state.partsByMessageId[part.messageID] ?? [];
  const nextParts = currentParts.some((current) => current.id === part.id)
    ? currentParts.map((current) =>
        current.id === part.id ? { ...current, ...part } : current,
      )
    : sortParts([...currentParts, part]);

  return {
    ...state,
    partsByMessageId: {
      ...state.partsByMessageId,
      [part.messageID]: nextParts,
    },
  };
}

function upsertQuestionRequest(
  state: OpenCodeChatState,
  question: OpenCodeQuestionRequest,
): OpenCodeChatState {
  const currentQuestions = state.questionRequestsBySessionId[question.sessionID] ?? [];
  const nextQuestions = currentQuestions.some((current) => current.id === question.id)
    ? currentQuestions.map((current) =>
        current.id === question.id ? { ...current, ...question } : current,
      )
    : sortQuestionRequests([...currentQuestions, question]);

  return {
    ...state,
    questionRequestsBySessionId: {
      ...state.questionRequestsBySessionId,
      [question.sessionID]: nextQuestions,
    },
  };
}

function removeQuestionRequest(
  state: OpenCodeChatState,
  sessionId: string,
  requestId: string,
): OpenCodeChatState {
  const currentQuestions = state.questionRequestsBySessionId[sessionId] ?? [];
  if (currentQuestions.length === 0) return state;

  const nextQuestions = currentQuestions.filter((question) => question.id !== requestId);
  if (nextQuestions.length === currentQuestions.length) {
    return state;
  }

  const questionRequestsBySessionId = { ...state.questionRequestsBySessionId };
  if (nextQuestions.length === 0) {
    delete questionRequestsBySessionId[sessionId];
  } else {
    questionRequestsBySessionId[sessionId] = nextQuestions;
  }

  return {
    ...state,
    questionRequestsBySessionId,
  };
}

function removePart(
  state: OpenCodeChatState,
  messageId: string,
  partId: string,
): OpenCodeChatState {
  const currentParts = state.partsByMessageId[messageId] ?? [];
  if (currentParts.length === 0) return state;

  const nextParts = currentParts.filter((part) => part.id !== partId);
  if (nextParts.length === currentParts.length) return state;

  const partsByMessageId = { ...state.partsByMessageId };
  if (nextParts.length === 0) {
    delete partsByMessageId[messageId];
  } else {
    partsByMessageId[messageId] = nextParts;
  }

  return {
    ...state,
    partsByMessageId,
  };
}

function applyPartDelta(
  state: OpenCodeChatState,
  payload: { messageID: string; partID: string; field: string; delta: string },
): OpenCodeChatState {
  const currentParts = state.partsByMessageId[payload.messageID] ?? [];
  const index = currentParts.findIndex((part) => part.id === payload.partID);
  if (index < 0) return state;

  const currentPart = currentParts[index];
  const currentValue = currentPart[payload.field];
  const nextValue =
    typeof currentValue === "string"
      ? currentValue + payload.delta
      : payload.delta;
  const nextPart = {
    ...currentPart,
    [payload.field]: nextValue,
  };
  const nextParts = [...currentParts];
  nextParts[index] = nextPart;

  return {
    ...state,
    partsByMessageId: {
      ...state.partsByMessageId,
      [payload.messageID]: nextParts,
    },
  };
}

function applyBridgeStatus(
  state: OpenCodeChatState,
  event: CanonicalChatEvent,
): OpenCodeChatState {
  const properties = (event.properties ?? {}) as {
    state?: OpenCodeChatState["connection"]["state"];
    message?: string;
  };

  if (!properties.state) return state;
  return {
    ...state,
    connection: {
      state: properties.state,
      ...(properties.message ? { message: properties.message } : {}),
    },
  };
}

function applyCanonicalEvent(
  state: OpenCodeChatState,
  event: CanonicalChatEvent,
): OpenCodeChatState {
  const nextState = event.eventId
    ? {
        ...state,
        lastEventId: event.eventId,
        lastEventType: event.type,
        lastEventTime: event.timestamp ?? Date.now(),
      }
    : state;

  if (event.type === "bridge.status") {
    return applyBridgeStatus(nextState, event);
  }

  switch (event.type) {
    case "session.updated":
    case "session.created": {
      const session = (event.properties as { info?: OpenCodeSession })?.info;
      if (!session?.id) return nextState;
      return upsertSession(nextState, session);
    }

    case "session.deleted": {
      const session = (event.properties as { info?: OpenCodeSession })?.info;
      if (!session?.id) return nextState;
      const sessionsById = { ...nextState.sessionsById };
      delete sessionsById[session.id];
      const sessionStatusById = { ...nextState.sessionStatusById };
      delete sessionStatusById[session.id];
      const questionRequestsBySessionId = { ...nextState.questionRequestsBySessionId };
      delete questionRequestsBySessionId[session.id];
      return {
        ...nextState,
        sessionsById,
        sessionStatusById,
        questionRequestsBySessionId,
        sessionOrder: sortSessionIds(sessionsById),
      };
    }

    case "session.status": {
      const props = (event.properties ?? {}) as {
        sessionID?: string;
        status?: OpenCodeSessionStatus;
      };
      if (!props.sessionID || !props.status) return nextState;
      return {
        ...nextState,
        sessionStatusById: {
          ...nextState.sessionStatusById,
          [props.sessionID]: props.status,
        },
      };
    }

    case "message.updated": {
      const message = (event.properties as { info?: OpenCodeMessage })?.info;
      if (!message?.id || !message.sessionID) return nextState;
      return upsertMessage(nextState, message);
    }

    case "message.removed": {
      const props = (event.properties ?? {}) as {
        sessionID?: string;
        messageID?: string;
      };
      if (!props.sessionID || !props.messageID) return nextState;
      return removeMessage(nextState, props.sessionID, props.messageID);
    }

    case "message.part.updated": {
      const part = (event.properties as { part?: OpenCodePart })?.part;
      if (!part?.id || !part.messageID) return nextState;
      return upsertPart(nextState, part);
    }

    case "message.part.removed": {
      const props = (event.properties ?? {}) as {
        messageID?: string;
        partID?: string;
      };
      if (!props.messageID || !props.partID) return nextState;
      return removePart(nextState, props.messageID, props.partID);
    }

    case "message.part.delta": {
      const props = (event.properties ?? {}) as {
        messageID?: string;
        partID?: string;
        field?: string;
        delta?: string;
      };
      if (!props.messageID || !props.partID || !props.field || !props.delta) {
        return nextState;
      }
      return applyPartDelta(nextState, {
        messageID: props.messageID,
        partID: props.partID,
        field: props.field,
        delta: props.delta,
      });
    }

    case "question.asked": {
      const question = (event.properties ?? {}) as OpenCodeQuestionRequest;
      if (!question?.id || !question.sessionID) return nextState;
      return upsertQuestionRequest(nextState, question);
    }

    case "question.replied":
    case "question.rejected": {
      const props = (event.properties ?? {}) as {
        sessionID?: string;
        requestID?: string;
      };
      if (!props.sessionID || !props.requestID) return nextState;
      return removeQuestionRequest(nextState, props.sessionID, props.requestID);
    }

    default:
      return nextState;
  }
}

export function upsertSessionMessagesIntoState(
  state: OpenCodeChatState,
  messages: OpenCodeSessionMessageRecord[],
): OpenCodeChatState {
  return messages.reduce((currentState, record) => {
    const info = record.info;
    if (!info?.id || !info.sessionID) return currentState;

    let nextState = upsertMessage(currentState, info);
    const parts = sortParts(record.parts ?? []);
    if (parts.length > 0) {
      nextState = {
        ...nextState,
        partsByMessageId: {
          ...nextState.partsByMessageId,
          [info.id]: parts,
        },
      };
    }
    return nextState;
  }, state);
}

export function openCodeChatReducer(
  state: OpenCodeChatState = OPEN_CODE_CHAT_INITIAL_STATE,
  action: OpenCodeChatAction,
): OpenCodeChatState {
  switch (action.type) {
    case "bootstrap.loaded":
      return createStateFromBootstrap(action.payload);

    case "session.messages.loaded":
      return mergeSessionMessagesIntoState(
        state,
        action.payload.sessionId,
        action.payload.messages,
      );

    case "event.received":
      return applyCanonicalEvent(state, action.payload);

    case "events.receivedBatch":
      return action.payload.reduce(
        (currentState, event) => applyCanonicalEvent(currentState, event),
        state,
      );

    case "connection.updated":
      return {
        ...state,
        connection: {
          state: action.payload.state,
          ...(action.payload.message ? { message: action.payload.message } : {}),
        },
      };

    default:
      return state;
  }
}
