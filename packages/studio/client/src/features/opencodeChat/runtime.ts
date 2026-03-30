import type {
  OpenCodeConnectionState,
  OpenCodeMessage,
  OpenCodeSessionActivitySummary,
  OpenCodeQuestionRequest,
  OpenCodeSession,
  OpenCodeSessionMessageRecord,
  OpenCodeSessionStatus,
} from "./types";
import { sanitizeSessionError, type SanitizedSessionError } from "./sync/errorPolicy";

type DeriveChatActivityStateArgs = {
  messages: OpenCodeSessionMessageRecord[];
  sessionStatus: OpenCodeSessionStatus | null;
  hasOptimisticUserMessage: boolean;
  isSubmitting: boolean;
};

type BuildDerivedSessionErrorArgs = {
  selectedSessionId: string | null;
  messages: OpenCodeSessionMessageRecord[];
  sessionMessagesIsError: boolean;
  sessionMessagesError: unknown;
  sessionStatus: OpenCodeSessionStatus | null;
  connectionState: OpenCodeConnectionState;
  connectionMessage?: string;
};

export type DerivedSessionError = {
  key: string;
  error: SanitizedSessionError;
} | null;

export type StaleRunningToolState = {
  messageId: string;
  reason: "completed_message" | "superseded_message";
};

export function isActiveSessionStatus(
  status: OpenCodeSessionStatus | null | undefined,
): boolean {
  return status?.type === "busy" || status?.type === "retry";
}

export function isTerminalSessionStatusType(
  type: string | null | undefined,
): boolean {
  return type === "idle" || type === "done" || type === "error";
}

export function getLastMessageRole(
  messages: OpenCodeSessionMessageRecord[],
): "agent" | "user" | null {
  const role = messages[messages.length - 1]?.info?.role;
  if (role === "assistant") {
    return "agent";
  }
  if (role === "user") {
    return "user";
  }
  return null;
}

export function hasPendingAssistantMessage(
  messages: OpenCodeSessionMessageRecord[],
): boolean {
  return messages.some((message) => {
    return (
      message.info?.role === "assistant" &&
      typeof message.info?.time?.completed !== "number"
    );
  });
}

function isRunningToolPart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false;
  }

  const record = part as {
    type?: unknown;
    status?: unknown;
    state?: { status?: unknown };
  };
  const status = record.status ?? record.state?.status;
  return record.type === "tool" && status === "running";
}

export function findStaleRunningToolState(
  messages: OpenCodeSessionMessageRecord[],
): StaleRunningToolState | null {
  let latestAssistantIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.info?.role === "assistant") {
      latestAssistantIndex = index;
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.info?.role !== "assistant") {
      continue;
    }

    const hasRunningTool = (message.parts ?? []).some(isRunningToolPart);
    if (!hasRunningTool || !message.info?.id) {
      continue;
    }

    if (typeof message.info.time?.completed === "number") {
      return {
        messageId: message.info.id,
        reason: "completed_message",
      };
    }

    if (index < latestAssistantIndex) {
      return {
        messageId: message.info.id,
        reason: "superseded_message",
      };
    }
  }

  return null;
}

export function deriveChatActivityState({
  messages,
  sessionStatus,
  hasOptimisticUserMessage,
  isSubmitting,
}: DeriveChatActivityStateArgs) {
  const sessionActive = isActiveSessionStatus(sessionStatus);
  const lastMessageRole = getLastMessageRole(messages);
  const hasPendingAssistant = hasPendingAssistantMessage(messages);
  const isStreaming = hasPendingAssistant;
  const isWaiting =
    hasOptimisticUserMessage ||
    isSubmitting ||
    (!hasPendingAssistant && sessionActive);
  const isThinking = isStreaming || isWaiting;

  return {
    lastMessageRole,
    hasPendingAssistant,
    isSessionStatusActive: sessionActive,
    isStreaming,
    isWaiting,
    isThinking,
  };
}

export function buildDerivedSessionError({
  selectedSessionId,
  messages,
  sessionMessagesIsError,
  sessionMessagesError,
  sessionStatus,
  connectionState,
  connectionMessage,
}: BuildDerivedSessionErrorArgs): DerivedSessionError {
  if (selectedSessionId && sessionMessagesIsError) {
    const message =
      sessionMessagesError &&
      typeof sessionMessagesError === "object" &&
      "message" in sessionMessagesError
        ? (sessionMessagesError as { message?: unknown }).message
        : "Failed to load session";

    return {
      key: `load:${selectedSessionId}:${String(message)}`,
      error: sanitizeSessionError({
        type: "load",
        message,
      }),
    };
  }

  if (sessionStatus?.type === "retry") {
    return {
      key: `retry:${selectedSessionId ?? "none"}:${sessionStatus.attempt ?? 0}:${sessionStatus.message ?? ""}:${sessionStatus.next ?? 0}`,
      error: sanitizeSessionError({
        type: "retry",
        message: sessionStatus.message,
        attempt: sessionStatus.attempt,
        nextRetryAt: sessionStatus.next,
      }),
    };
  }

  if (
    selectedSessionId &&
    connectionState === "error" &&
    (isActiveSessionStatus(sessionStatus) || hasPendingAssistantMessage(messages))
  ) {
    return {
      key: `stream:${selectedSessionId}:${connectionMessage ?? ""}`,
      error: sanitizeSessionError({
        type: "stream",
        message: connectionMessage,
      }),
    };
  }

  return null;
}

export function selectSessionActivitySummary(args: {
  sessions: OpenCodeSession[];
  sessionStatusById: Record<string, OpenCodeSessionStatus>;
  messagesById: Record<string, OpenCodeMessage>;
  messagesBySessionId: Record<string, string[]>;
  selectedSessionId: string | null;
}): OpenCodeSessionActivitySummary {
  const activeSessionIds = selectLikelyActiveSessionIds(args);
  const selectedSessionId = args.selectedSessionId ?? null;
  const selectedSessionIsActive = Boolean(
    selectedSessionId && activeSessionIds.includes(selectedSessionId),
  );
  const otherActiveSessionIds = activeSessionIds.filter(
    (sessionId) => sessionId !== selectedSessionId,
  );

  return {
    selectedSessionId,
    activeSessionIds,
    selectedSessionIsActive,
    otherActiveSessionIds,
    otherActiveSessionCount: otherActiveSessionIds.length,
    hasAnyActiveSession: activeSessionIds.length > 0,
    hasOtherActiveSessions: otherActiveSessionIds.length > 0,
  };
}

export function selectLikelyActiveSessionIds(args: {
  sessions: OpenCodeSession[];
  sessionStatusById: Record<string, OpenCodeSessionStatus>;
  messagesById: Record<string, OpenCodeMessage>;
  messagesBySessionId: Record<string, string[]>;
}): string[] {
  return args.sessions
    .filter((session) => {
      if (isActiveSessionStatus(args.sessionStatusById[session.id] ?? null)) {
        return true;
      }

      const messageIds = args.messagesBySessionId[session.id] ?? [];
      return messageIds.some((messageId) => {
        const message = args.messagesById[messageId];
        return (
          message?.role === "assistant" &&
          typeof message.time?.completed !== "number"
        );
      });
    })
    .map((session) => session.id);
}

export function selectMostRecentActiveSessionId(args: {
  sessions: OpenCodeSession[];
  sessionStatusById: Record<string, OpenCodeSessionStatus>;
}): string | null {
  const activeSessions = args.sessions.filter((session) =>
    isActiveSessionStatus(args.sessionStatusById[session.id] ?? null),
  );

  if (activeSessions.length === 0) {
    return null;
  }

  const getSessionTimestamp = (session: OpenCodeSession) =>
    session.time?.updated ?? session.time?.created ?? 0;

  return activeSessions.reduce((latest, session) => {
    return getSessionTimestamp(session) > getSessionTimestamp(latest)
      ? session
      : latest;
  }, activeSessions[0]).id;
}

export function selectMostRecentAttentionSessionId(args: {
  sessions: OpenCodeSession[];
  sessionStatusById: Record<string, OpenCodeSessionStatus>;
  questionRequestsBySessionId: Record<string, OpenCodeQuestionRequest[]>;
}): string | null {
  const sessionsNeedingAttention = args.sessions.filter((session) => {
    if (isActiveSessionStatus(args.sessionStatusById[session.id] ?? null)) {
      return true;
    }
    return (args.questionRequestsBySessionId[session.id]?.length ?? 0) > 0;
  });

  if (sessionsNeedingAttention.length === 0) {
    return null;
  }

  const getSessionTimestamp = (session: OpenCodeSession) =>
    session.time?.updated ?? session.time?.created ?? 0;

  return sessionsNeedingAttention.reduce((latest, session) => {
    return getSessionTimestamp(session) > getSessionTimestamp(latest)
      ? session
      : latest;
  }, sessionsNeedingAttention[0]).id;
}
