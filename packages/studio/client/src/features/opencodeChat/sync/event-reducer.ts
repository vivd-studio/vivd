import type {
  CanonicalChatEvent,
  OpenCodeChatAction,
  OpenCodeChatState,
  OpenCodeMessage,
  OpenCodePermissionRequest,
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
  reconcileStateFromBootstrap,
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

function sortPermissionRequests(
  permissions: OpenCodePermissionRequest[],
): OpenCodePermissionRequest[] {
  return [...permissions].sort((left, right) => compareStrings(left.id, right.id));
}

function shouldPreserveExistingStringField(
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

function mergeSnapshotPart(
  existingPart: OpenCodePart | undefined,
  incomingPart: OpenCodePart,
): OpenCodePart {
  if (!existingPart) {
    return incomingPart;
  }

  const merged: OpenCodePart = {
    ...existingPart,
    ...incomingPart,
  };

  for (const [field, existingValue] of Object.entries(existingPart)) {
    const incomingValue = incomingPart[field];
    if (
      typeof existingValue === "string" &&
      typeof incomingValue === "string" &&
      shouldPreserveExistingStringField(existingValue, incomingValue)
    ) {
      merged[field] = existingValue;
    }
  }

  return merged;
}

function upsertSession(
  state: OpenCodeChatState,
  session: OpenCodeSession,
): OpenCodeChatState {
  const existingSession = state.sessionsById[session.id];
  const sessionsById = {
    ...state.sessionsById,
    [session.id]: {
      ...existingSession,
      ...session,
      ...(existingSession?.time || session.time
        ? {
            time: {
              ...existingSession?.time,
              ...session.time,
            },
          }
        : {}),
    },
  };

  return {
    ...state,
    sessionsById,
    sessionOrder: sortSessionIds(sessionsById),
  };
}

function removeSessionCaches(
  state: OpenCodeChatState,
  sessionId: string,
): OpenCodeChatState {
  const messageIds = state.messagesBySessionId[sessionId] ?? [];
  if (
    messageIds.length === 0 &&
    !state.sessionStatusById[sessionId] &&
    !state.questionRequestsBySessionId[sessionId] &&
    !state.permissionRequestsBySessionId[sessionId]
  ) {
    return state;
  }

  const messagesById = { ...state.messagesById };
  const partsByMessageId = { ...state.partsByMessageId };
  const pendingPartDeltasByMessageId = { ...state.pendingPartDeltasByMessageId };
  for (const messageId of messageIds) {
    delete messagesById[messageId];
    delete partsByMessageId[messageId];
    delete pendingPartDeltasByMessageId[messageId];
  }

  const messagesBySessionId = { ...state.messagesBySessionId };
  delete messagesBySessionId[sessionId];

  const sessionStatusById = { ...state.sessionStatusById };
  delete sessionStatusById[sessionId];

  const questionRequestsBySessionId = { ...state.questionRequestsBySessionId };
  delete questionRequestsBySessionId[sessionId];
  const permissionRequestsBySessionId = { ...state.permissionRequestsBySessionId };
  delete permissionRequestsBySessionId[sessionId];

  return {
    ...state,
    messagesById,
    messagesBySessionId,
    partsByMessageId,
    pendingPartDeltasByMessageId,
    sessionStatusById,
    questionRequestsBySessionId,
    permissionRequestsBySessionId,
  };
}

function removeSession(
  state: OpenCodeChatState,
  sessionId: string,
): OpenCodeChatState {
  const sessionsById = { ...state.sessionsById };
  delete sessionsById[sessionId];

  const withoutSession = {
    ...state,
    sessionsById,
    sessionOrder: sortSessionIds(sessionsById),
  };

  return removeSessionCaches(withoutSession, sessionId);
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
  const pendingPartDeltasByMessageId = { ...state.pendingPartDeltasByMessageId };
  delete pendingPartDeltasByMessageId[messageId];

  return {
    ...state,
    messagesById,
    partsByMessageId,
    pendingPartDeltasByMessageId,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: nextMessageIds,
    },
  };
}

function clearPendingPartDeltas(
  state: OpenCodeChatState,
  messageId: string,
  partId: string,
): OpenCodeChatState {
  const pendingByMessage = state.pendingPartDeltasByMessageId[messageId];
  if (!pendingByMessage?.[partId]) {
    return state;
  }

  const nextPendingByMessage = { ...pendingByMessage };
  delete nextPendingByMessage[partId];

  const pendingPartDeltasByMessageId = {
    ...state.pendingPartDeltasByMessageId,
  };

  if (Object.keys(nextPendingByMessage).length === 0) {
    delete pendingPartDeltasByMessageId[messageId];
  } else {
    pendingPartDeltasByMessageId[messageId] = nextPendingByMessage;
  }

  return {
    ...state,
    pendingPartDeltasByMessageId,
  };
}

function mergePendingPartDeltasIntoPart(
  state: OpenCodeChatState,
  part: OpenCodePart,
): { state: OpenCodeChatState; part: OpenCodePart } {
  const pendingFields =
    state.pendingPartDeltasByMessageId[part.messageID]?.[part.id];
  if (!pendingFields) {
    return { state, part };
  }

  const nextPart = { ...part };
  for (const [field, pendingDelta] of Object.entries(pendingFields)) {
    const existing = nextPart[field];
    if (typeof existing === "string") {
      if (
        existing === pendingDelta ||
        existing.startsWith(pendingDelta) ||
        existing.includes(pendingDelta)
      ) {
        continue;
      }
      nextPart[field] = pendingDelta + existing;
      continue;
    }
    nextPart[field] = pendingDelta;
  }

  return {
    state: clearPendingPartDeltas(state, part.messageID, part.id),
    part: nextPart,
  };
}

function upsertMessage(
  state: OpenCodeChatState,
  message: OpenCodeMessage,
): OpenCodeChatState {
  const existingMessage = state.messagesById[message.id];
  const messagesById = {
    ...state.messagesById,
    [message.id]: {
      ...existingMessage,
      ...message,
      ...(existingMessage?.time || message.time
        ? {
            time: {
              ...existingMessage?.time,
              ...message.time,
            },
          }
        : {}),
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
  const merged = mergePendingPartDeltasIntoPart(state, part);
  const currentParts = merged.state.partsByMessageId[part.messageID] ?? [];
  const nextParts = currentParts.some((current) => current.id === part.id)
    ? currentParts.map((current) =>
        current.id === part.id ? { ...current, ...merged.part } : current,
      )
    : sortParts([...currentParts, merged.part]);

  return {
    ...merged.state,
    partsByMessageId: {
      ...merged.state.partsByMessageId,
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

function upsertPermissionRequest(
  state: OpenCodeChatState,
  permission: OpenCodePermissionRequest,
): OpenCodeChatState {
  const currentPermissions =
    state.permissionRequestsBySessionId[permission.sessionID] ?? [];
  const nextPermissions = currentPermissions.some(
    (current) => current.id === permission.id,
  )
    ? currentPermissions.map((current) =>
        current.id === permission.id ? { ...current, ...permission } : current,
      )
    : sortPermissionRequests([...currentPermissions, permission]);

  return {
    ...state,
    permissionRequestsBySessionId: {
      ...state.permissionRequestsBySessionId,
      [permission.sessionID]: nextPermissions,
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

function removePermissionRequest(
  state: OpenCodeChatState,
  sessionId: string,
  requestId: string,
): OpenCodeChatState {
  const currentPermissions = state.permissionRequestsBySessionId[sessionId] ?? [];
  if (currentPermissions.length === 0) return state;

  const nextPermissions = currentPermissions.filter(
    (permission) => permission.id !== requestId,
  );
  if (nextPermissions.length === currentPermissions.length) {
    return state;
  }

  const permissionRequestsBySessionId = {
    ...state.permissionRequestsBySessionId,
  };
  if (nextPermissions.length === 0) {
    delete permissionRequestsBySessionId[sessionId];
  } else {
    permissionRequestsBySessionId[sessionId] = nextPermissions;
  }

  return {
    ...state,
    permissionRequestsBySessionId,
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
  if (index < 0) {
    const pendingByMessage =
      state.pendingPartDeltasByMessageId[payload.messageID] ?? {};
    const pendingByPart = pendingByMessage[payload.partID] ?? {};
    const existingDelta = pendingByPart[payload.field] ?? "";

    return {
      ...state,
      pendingPartDeltasByMessageId: {
        ...state.pendingPartDeltasByMessageId,
        [payload.messageID]: {
          ...pendingByMessage,
          [payload.partID]: {
            ...pendingByPart,
            [payload.field]: existingDelta + payload.delta,
          },
        },
      },
    };
  }

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
  const nextState: OpenCodeChatState = {
    ...state,
    connection: {
      state: properties.state,
      ...(properties.message ? { message: properties.message } : {}),
    },
  };

  if (properties.state === "connected") {
    return nextState;
  }

  return {
    ...nextState,
    refreshGeneration: nextState.refreshGeneration + 1,
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
    case "session.created": {
      const session = (event.properties as { info?: OpenCodeSession })?.info;
      if (!session?.id) return nextState;
      return upsertSession(nextState, session);
    }

    case "session.updated": {
      const session = (event.properties as { info?: OpenCodeSession })?.info;
      if (!session?.id) return nextState;
      if (session.time?.archived) {
        return removeSession(nextState, session.id);
      }
      return upsertSession(nextState, session);
    }

    case "session.deleted": {
      const session = (event.properties as { info?: OpenCodeSession })?.info;
      if (!session?.id) return nextState;
      return removeSession(nextState, session.id);
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

    case "permission.asked": {
      const permission = (event.properties ?? {}) as OpenCodePermissionRequest;
      if (!permission?.id || !permission.sessionID) return nextState;
      return upsertPermissionRequest(nextState, permission);
    }

    case "permission.replied": {
      const props = (event.properties ?? {}) as {
        sessionID?: string;
        requestID?: string;
      };
      if (!props.sessionID || !props.requestID) return nextState;
      return removePermissionRequest(nextState, props.sessionID, props.requestID);
    }

    default:
      return nextState;
  }
}

export function upsertSessionMessagesIntoState(
  state: OpenCodeChatState,
  messages: OpenCodeSessionMessageRecord[],
  options?: {
    preserveExistingParts?: boolean;
  },
): OpenCodeChatState {
  return messages.reduce((currentState, record) => {
    const info = record.info;
    if (!info?.id || !info.sessionID) return currentState;

    let nextState = upsertMessage(currentState, info);
    const parts = sortParts(record.parts ?? []);
    if (parts.length > 0) {
      const currentParts =
        options?.preserveExistingParts
          ? nextState.partsByMessageId[info.id] ?? []
          : [];
      const partsById = new Map<string, OpenCodePart>();
      for (const currentPart of currentParts) {
        partsById.set(currentPart.id, currentPart);
      }
      for (const part of parts) {
        partsById.set(part.id, mergeSnapshotPart(partsById.get(part.id), part));
      }
      nextState = {
        ...nextState,
        partsByMessageId: {
          ...nextState.partsByMessageId,
          [info.id]: sortParts(Array.from(partsById.values())),
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

    case "bootstrap.refreshed":
      return reconcileStateFromBootstrap(state, action.payload);

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
