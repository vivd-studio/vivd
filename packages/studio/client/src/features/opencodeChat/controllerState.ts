import { sessionPermissionRequest, sessionQuestionRequest } from "./questions/requestTree";
import { calculateUsageFromSessionMessages } from "./render/sessionMetrics";
import {
  buildDerivedSessionError,
  deriveChatActivityState,
  findStaleRunningToolState,
  isActiveSessionStatus,
  isTerminalSessionStatusType,
  selectMostRecentAttentionSessionId,
  type DerivedSessionError,
  type StaleRunningToolState,
} from "./runtime";
import type {
  OpenCodeConnectionState,
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  OpenCodeSession,
  OpenCodeSessionMessageRecord,
  OpenCodeSessionStatus,
} from "./types";

type DeriveOpencodeControllerStateArgs = {
  sessions: OpenCodeSession[];
  selectedSessionId: string | null;
  selectedMessages: OpenCodeSessionMessageRecord[];
  sessionStatusById: Record<string, OpenCodeSessionStatus>;
  questionRequestsBySessionId: Record<string, OpenCodeQuestionRequest[]>;
  permissionRequestsBySessionId: Record<string, OpenCodePermissionRequest[]>;
  selectedSessionStatus: OpenCodeSessionStatus | null;
  selectedSessionIsError: boolean;
  selectedSessionError: unknown;
  connectionState: OpenCodeConnectionState;
  connectionMessage?: string;
  hasOptimisticUserMessage: boolean;
  isSubmitting: boolean;
  suppressedSessionId?: string | null;
};

export type OpencodeControllerDerivedState = {
  selectedSession: OpenCodeSession | null;
  attentionSessionId: string | null;
  activeQuestionRequest: OpenCodeQuestionRequest | null;
  activePermissionRequest: OpenCodePermissionRequest | null;
  hasBlockingRequest: boolean;
  isReverted: boolean;
  usage: ReturnType<typeof calculateUsageFromSessionMessages>;
  staleRunningToolState: StaleRunningToolState | null;
  terminalPendingAssistantMessageId: string | null;
  derivedSessionError: DerivedSessionError;
  activityState: ReturnType<typeof deriveChatActivityState>;
  sessionShowsRunActivity: boolean;
};

export function findTerminalPendingAssistantMessageId(args: {
  selectedSessionId: string | null;
  selectedMessages: OpenCodeSessionMessageRecord[];
  selectedSessionStatus: OpenCodeSessionStatus | null;
  suppressedSessionId?: string | null;
}): string | null {
  if (
    !args.selectedSessionId ||
    args.suppressedSessionId === args.selectedSessionId ||
    !isTerminalSessionStatusType(args.selectedSessionStatus?.type ?? null)
  ) {
    return null;
  }

  for (let index = args.selectedMessages.length - 1; index >= 0; index -= 1) {
    const message = args.selectedMessages[index]?.info;
    if (message?.role !== "assistant" || !message.id) {
      continue;
    }
    if (typeof message.time?.completed === "number") {
      continue;
    }
    return message.id;
  }

  return null;
}

export function deriveOpencodeControllerState({
  sessions,
  selectedSessionId,
  selectedMessages,
  sessionStatusById,
  questionRequestsBySessionId,
  permissionRequestsBySessionId,
  selectedSessionStatus,
  selectedSessionIsError,
  selectedSessionError,
  connectionState,
  connectionMessage,
  hasOptimisticUserMessage,
  isSubmitting,
  suppressedSessionId = null,
}: DeriveOpencodeControllerStateArgs): OpencodeControllerDerivedState {
  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;
  const attentionSessionId = selectMostRecentAttentionSessionId({
    sessions,
    sessionStatusById,
    questionRequestsBySessionId,
    permissionRequestsBySessionId,
  });
  const requestSessionId = selectedSessionId ?? attentionSessionId;
  const activeQuestionRequest =
    sessionQuestionRequest(sessions, questionRequestsBySessionId, requestSessionId) ??
    null;
  const activePermissionRequest =
    sessionPermissionRequest(
      sessions,
      permissionRequestsBySessionId,
      requestSessionId,
    ) ?? null;
  const hasBlockingRequest = Boolean(
    activeQuestionRequest || activePermissionRequest,
  );
  const isReverted = Boolean(selectedSession?.revert);
  const usage = calculateUsageFromSessionMessages(selectedMessages);
  const staleRunningToolState = findStaleRunningToolState(selectedMessages);
  const terminalPendingAssistantMessageId = findTerminalPendingAssistantMessageId({
    selectedSessionId,
    selectedMessages,
    selectedSessionStatus,
    suppressedSessionId,
  });
  const derivedSessionError = buildDerivedSessionError({
    selectedSessionId,
    messages: selectedMessages,
    sessionMessagesIsError: selectedSessionIsError,
    sessionMessagesError: selectedSessionError,
    sessionStatus: selectedSessionStatus,
    connectionState,
    connectionMessage,
    suppressPendingAssistant: suppressedSessionId === selectedSessionId,
  });
  const activityState = deriveChatActivityState({
    messages: selectedMessages,
    sessionStatus: selectedSessionStatus,
    hasOptimisticUserMessage,
    isSubmitting,
    suppressPendingAssistant: suppressedSessionId === selectedSessionId,
  });
  const sessionShowsRunActivity =
    activityState.isStreaming || isActiveSessionStatus(selectedSessionStatus);

  return {
    selectedSession,
    attentionSessionId,
    activeQuestionRequest,
    activePermissionRequest,
    hasBlockingRequest,
    isReverted,
    usage,
    staleRunningToolState,
    terminalPendingAssistantMessageId,
    derivedSessionError,
    activityState,
    sessionShowsRunActivity,
  };
}
