import type {
  OpenCodeConnectionState,
  OpenCodeMessage,
  OpenCodePermissionRequest,
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
  now?: number;
  suppressPendingAssistant?: boolean;
};

type BuildDerivedSessionErrorArgs = {
  selectedSessionId: string | null;
  messages: OpenCodeSessionMessageRecord[];
  sessionMessagesIsError: boolean;
  sessionMessagesError: unknown;
  sessionStatus: OpenCodeSessionStatus | null;
  connectionState: OpenCodeConnectionState;
  connectionMessage?: string;
  now?: number;
  suppressPendingAssistant?: boolean;
};

export type DerivedSessionError = {
  key: string;
  error: SanitizedSessionError;
} | null;

export type StaleRunningToolState = {
  messageId: string;
  reason: "completed_message" | "superseded_message";
};

export const PENDING_ASSISTANT_GRACE_MS = 15_000;

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
    return isPendingAssistantMessageInfo(message.info);
  });
}

function isPendingAssistantMessageInfo(
  message: OpenCodeMessage | null | undefined,
): boolean {
  return (
    message?.role === "assistant" &&
    typeof message.time?.completed !== "number"
  );
}

function getMessageActivityAt(
  message: OpenCodeMessage | null | undefined,
): number | null {
  const updatedAt =
    typeof message?.time?.updated === "number" ? message.time.updated : null;
  const createdAt =
    typeof message?.time?.created === "number" ? message.time.created : null;
  return updatedAt ?? createdAt;
}

export function isLivePendingAssistantMessageInfo(
  message: OpenCodeMessage | null | undefined,
  options?: {
    sessionStatus?: OpenCodeSessionStatus | null;
    now?: number;
  },
): boolean {
  if (!isPendingAssistantMessageInfo(message)) {
    return false;
  }

  if (isActiveSessionStatus(options?.sessionStatus)) {
    return true;
  }

  const activityAt = getMessageActivityAt(message);
  if (activityAt == null) {
    return false;
  }

  return (options?.now ?? Date.now()) - activityAt <= PENDING_ASSISTANT_GRACE_MS;
}

export function getMostRecentPendingAssistantActivityAt(
  messages: OpenCodeSessionMessageRecord[],
): number | null {
  let latest: number | null = null;

  for (const message of messages) {
    if (!isPendingAssistantMessageInfo(message.info)) {
      continue;
    }

    const activityAt = getMessageActivityAt(message.info);
    if (activityAt == null) {
      continue;
    }

    if (latest == null || activityAt > latest) {
      latest = activityAt;
    }
  }

  return latest;
}

export function hasLivePendingAssistantMessage(
  messages: OpenCodeSessionMessageRecord[],
  options?: {
    sessionStatus?: OpenCodeSessionStatus | null;
    now?: number;
  },
): boolean {
  return messages.some((message) =>
    isLivePendingAssistantMessageInfo(message.info, options),
  );
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
  now,
  suppressPendingAssistant = false,
}: DeriveChatActivityStateArgs) {
  const sessionActive = isActiveSessionStatus(sessionStatus);
  const lastMessageRole = getLastMessageRole(messages);
  const hasPendingAssistant = suppressPendingAssistant
    ? false
    : hasLivePendingAssistantMessage(messages, {
        sessionStatus,
        now,
      });
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
  now,
  suppressPendingAssistant = false,
}: BuildDerivedSessionErrorArgs): DerivedSessionError {
  if (selectedSessionId && sessionMessagesIsError && messages.length === 0) {
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

  if (sessionStatus?.type === "error") {
    return {
      key: `error:${selectedSessionId ?? "none"}:${sessionStatus.attempt ?? 0}:${sessionStatus.message ?? ""}`,
      error: sanitizeSessionError({
        type: "task",
        message: sessionStatus.message,
        attempt: sessionStatus.attempt,
        nextRetryAt: sessionStatus.next,
      }),
    };
  }

  if (
    selectedSessionId &&
    connectionState === "error" &&
    (isActiveSessionStatus(sessionStatus) ||
      (!suppressPendingAssistant &&
        hasLivePendingAssistantMessage(messages, {
          sessionStatus,
          now,
        })))
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
}, options?: { now?: number }): string[] {
  return args.sessions
    .filter((session) => {
      const sessionStatus = args.sessionStatusById[session.id] ?? null;
      if (isActiveSessionStatus(sessionStatus)) {
        return true;
      }

      const messageIds = args.messagesBySessionId[session.id] ?? [];
      return messageIds.some((messageId) => {
        const message = args.messagesById[messageId];
        return isLivePendingAssistantMessageInfo(message, {
          sessionStatus,
          now: options?.now,
        });
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
  permissionRequestsBySessionId: Record<string, OpenCodePermissionRequest[]>;
}): string | null {
  const sessionsNeedingAttention = args.sessions.filter((session) => {
    if (isActiveSessionStatus(args.sessionStatusById[session.id] ?? null)) {
      return true;
    }
    return (
      (args.questionRequestsBySessionId[session.id]?.length ?? 0) > 0 ||
      (args.permissionRequestsBySessionId[session.id]?.length ?? 0) > 0
    );
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
