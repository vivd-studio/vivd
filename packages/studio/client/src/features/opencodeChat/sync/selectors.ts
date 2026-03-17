import type {
  OpenCodeChatSessionViewMessage,
  OpenCodeChatState,
  OpenCodePart,
  OpenCodeSession,
  OpenCodeSessionStatus,
} from "../types";

export function selectSessions(state: OpenCodeChatState): OpenCodeSession[] {
  return state.sessionOrder
    .map((sessionId) => state.sessionsById[sessionId])
    .filter((session): session is OpenCodeSession => Boolean(session));
}

export function selectSessionStatus(
  state: OpenCodeChatState,
  sessionId: string | null | undefined,
): OpenCodeSessionStatus | null {
  if (!sessionId) return null;
  return state.sessionStatusById[sessionId] ?? null;
}

export function selectMessagesForSession(
  state: OpenCodeChatState,
  sessionId: string | null | undefined,
): OpenCodeChatSessionViewMessage[] {
  if (!sessionId) return [];
  const messageIds = state.messagesBySessionId[sessionId] ?? [];
  return messageIds
    .map((messageId) => {
      const info = state.messagesById[messageId];
      if (!info) return null;
      return {
        ...info,
        parts: selectPartsForMessage(state, messageId),
      };
    })
    .filter((message): message is OpenCodeChatSessionViewMessage => Boolean(message));
}

export function selectPartsForMessage(
  state: OpenCodeChatState,
  messageId: string,
): OpenCodePart[] {
  return state.partsByMessageId[messageId] ?? [];
}

export function selectSessionIsActive(
  state: OpenCodeChatState,
  sessionId: string | null | undefined,
): boolean {
  const status = selectSessionStatus(state, sessionId);
  return status?.type === "busy" || status?.type === "retry";
}
