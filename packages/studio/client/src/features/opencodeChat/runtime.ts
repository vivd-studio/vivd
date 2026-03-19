import type {
  OpenCodeConnectionState,
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
  selectedSessionId: string | null;
}): OpenCodeSessionActivitySummary {
  const activeSessionIds = args.sessions
    .filter((session) =>
      isActiveSessionStatus(args.sessionStatusById[session.id] ?? null),
    )
    .map((session) => session.id);
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
