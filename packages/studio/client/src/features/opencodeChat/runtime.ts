import type {
  OpenCodeConnectionState,
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

export function deriveChatActivityState({
  messages,
  sessionStatus,
  hasOptimisticUserMessage,
  isSubmitting,
}: DeriveChatActivityStateArgs) {
  const sessionActive = isActiveSessionStatus(sessionStatus);
  const lastMessageRole = getLastMessageRole(messages);
  const isStreaming = sessionActive && lastMessageRole === "agent";
  const isWaiting =
    hasOptimisticUserMessage ||
    isSubmitting ||
    (sessionActive && lastMessageRole !== "agent");
  const isThinking = isStreaming || isWaiting;

  return {
    lastMessageRole,
    isSessionStatusActive: sessionActive,
    isStreaming,
    isWaiting,
    isThinking,
  };
}

export function buildDerivedSessionError({
  selectedSessionId,
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

  if (selectedSessionId && connectionState === "error" && isActiveSessionStatus(sessionStatus)) {
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
