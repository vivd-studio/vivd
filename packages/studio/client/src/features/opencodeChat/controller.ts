import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { calculateUsageFromSessionMessages } from "./render/sessionMetrics";
import { useOpencodeChat } from "./provider";
import { sanitizeSessionError } from "./sync/errorPolicy";
import {
  buildDerivedSessionError,
  deriveChatActivityState,
  selectMostRecentActiveSessionId,
} from "./runtime";
import type { SanitizedSessionError } from "./sync/errorPolicy";

type ControllerModel = {
  provider: string;
  modelId: string;
} | null;

type UseOpencodeChatControllerArgs = {
  projectSlug: string;
  version?: number;
  selectedModel: ControllerModel;
  onTaskComplete?: () => void;
};

export function useOpencodeChatController({
  projectSlug,
  version,
  selectedModel,
  onTaskComplete,
}: UseOpencodeChatControllerArgs) {
  const opencodeChat = useOpencodeChat();
  const providerSetSelectedSessionId = opencodeChat.setSelectedSessionId;
  const sessionStatusById = opencodeChat.state.sessionStatusById;
  const connection = opencodeChat.state.connection;
  const [localSessionError, setLocalSessionError] =
    useState<SanitizedSessionError | null>(null);
  const [dismissedDerivedErrorKey, setDismissedDerivedErrorKey] = useState<
    string | null
  >(null);
  const [isSending, setIsSending] = useState(false);
  const autoSelectLockedRef = useRef(false);
  const hasAutoSelectedRunningSessionRef = useRef(false);
  const activeRunSessionIdRef = useRef<string | null>(null);

  const sessions = opencodeChat.sessions;
  const sessionsLoading = opencodeChat.bootstrapLoading;
  const selectedSessionId = opencodeChat.selectedSessionId;
  const selectedMessages = opencodeChat.selectedMessages;
  const currentSessionStatus = opencodeChat.sessionStatus;
  const sessionStatusType = currentSessionStatus?.type ?? null;
  const sessionMessagesIsError = opencodeChat.selectedSessionIsError;
  const sessionMessagesError = opencodeChat.selectedSessionError;
  const refetchMessages = opencodeChat.refetchSelectedSessionMessages;
  const refetchSessions = opencodeChat.refetchBootstrap;
  const isSessionHydrating = opencodeChat.selectedSessionLoading;
  const hasOptimisticUserMessage = opencodeChat.selectedHasOptimisticUserMessage;

  const setSelectedSessionId = useCallback(
    (sessionId: string | null) => {
      autoSelectLockedRef.current = true;
      providerSetSelectedSessionId(sessionId);
    },
    [providerSetSelectedSessionId],
  );

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const isReverted = Boolean(selectedSession?.revert);
  const usage = useMemo(
    () => calculateUsageFromSessionMessages(selectedMessages),
    [selectedMessages],
  );

  const buildRunTaskPayload = useCallback(
    (task: string, sessionId?: string | null) => ({
      projectSlug,
      task,
      ...(sessionId ? { sessionId } : {}),
      version,
      model: selectedModel
        ? {
            provider: selectedModel.provider,
            modelId: selectedModel.modelId,
          }
        : undefined,
    }),
    [projectSlug, selectedModel, version],
  );

  const runTaskMutation = trpc.agent.runTask.useMutation();
  const deleteSessionMutation = trpc.agent.deleteSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      if (selectedSessionId) {
        setSelectedSessionId(null);
      }
    },
  });
  const revertMutation = trpc.agent.revertToMessage.useMutation({
    onSuccess: (data) => {
      refetchSessions();
      onTaskComplete?.();
      if (Array.isArray(data.trackedFiles) && data.trackedFiles.length === 0) {
        toast.info("Nothing to revert", {
          description:
            "We couldn’t find any reversible changes for that message. This can happen when changes were made outside tracked edits (for example via terminal commands).",
        });
      }
    },
    onError: (error) => {
      toast.error("Revert failed", { description: error.message });
    },
  });
  const unrevertMutation = trpc.agent.unrevertSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      onTaskComplete?.();
    },
    onError: (error) => {
      toast.error("Restore failed", { description: error.message });
    },
  });
  const abortSessionMutation = trpc.agent.abortSession.useMutation({
    onSuccess: () => {
      refetchMessages();
    },
    onError: (error) => {
      setLocalSessionError(
        sanitizeSessionError({
          type: "task",
          message: error.message,
        }),
      );
    },
  });

  const sendTask = useCallback(
    (
      task: string,
      targetSessionId: string | null,
      options?: { onSettled?: () => void },
    ) => {
      const optimisticMessageId = opencodeChat.addOptimisticUserMessage({
        content: task,
        sessionId: targetSessionId,
        createdAt: Date.now(),
      });

      setLocalSessionError(null);
      setDismissedDerivedErrorKey(null);

      runTaskMutation.mutate(buildRunTaskPayload(task, targetSessionId), {
        onSuccess: (data) => {
          if (!data.sessionId) {
            return;
          }

          opencodeChat.assignOptimisticUserMessageSession(
            optimisticMessageId,
            data.sessionId,
          );

          if (data.sessionId !== selectedSessionId) {
            setSelectedSessionId(data.sessionId);
          }

          refetchSessions();
        },
        onError: (error) => {
          opencodeChat.removeOptimisticUserMessage(optimisticMessageId);
          setLocalSessionError(
            sanitizeSessionError({
              type: "task",
              message: error.message,
            }),
          );
          setDismissedDerivedErrorKey(null);
        },
        onSettled: () => {
          options?.onSettled?.();
        },
      });
    },
    [
      opencodeChat,
      runTaskMutation,
      buildRunTaskPayload,
      selectedSessionId,
      setSelectedSessionId,
      refetchSessions,
    ],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await deleteSessionMutation.mutateAsync({
        sessionId,
        projectSlug,
        version,
      });

      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
      }
    },
    [
      deleteSessionMutation,
      projectSlug,
      selectedSessionId,
      setSelectedSessionId,
      version,
    ],
  );

  const revertToMessage = useCallback(
    async (messageId: string) => {
      if (!selectedSessionId) return;
      await revertMutation.mutateAsync({
        sessionId: selectedSessionId,
        messageId,
        projectSlug,
        version,
      });
    },
    [projectSlug, revertMutation, selectedSessionId, version],
  );

  const unrevertSession = useCallback(async () => {
    if (!selectedSessionId) return;
    await unrevertMutation.mutateAsync({
      sessionId: selectedSessionId,
      projectSlug,
      version,
    });
  }, [projectSlug, selectedSessionId, unrevertMutation, version]);

  const stopGeneration = useCallback(() => {
    if (!selectedSessionId) return;
    abortSessionMutation.mutate({
      sessionId: selectedSessionId,
      projectSlug,
      version,
    });
  }, [abortSessionMutation, projectSlug, selectedSessionId, version]);

  const derivedSessionError = useMemo(
    () =>
      buildDerivedSessionError({
        selectedSessionId,
        sessionMessagesIsError,
        sessionMessagesError,
        sessionStatus: currentSessionStatus,
        connectionState: connection.state,
        connectionMessage: connection.message,
      }),
    [
      selectedSessionId,
      sessionMessagesIsError,
      sessionMessagesError,
      currentSessionStatus,
      connection.state,
      connection.message,
    ],
  );

  const sessionError =
    localSessionError ??
    (derivedSessionError &&
    derivedSessionError.key !== dismissedDerivedErrorKey
      ? derivedSessionError.error
      : null);

  const clearSessionError = useCallback(() => {
    setLocalSessionError(null);
    if (derivedSessionError) {
      setDismissedDerivedErrorKey(derivedSessionError.key);
    }
  }, [derivedSessionError]);

  const activityState = useMemo(
    () =>
      deriveChatActivityState({
        messages: selectedMessages,
        sessionStatus: currentSessionStatus,
        hasOptimisticUserMessage,
        isSubmitting: runTaskMutation.isPending || isSending,
      }),
    [
      selectedMessages,
      currentSessionStatus,
      hasOptimisticUserMessage,
      runTaskMutation.isPending,
      isSending,
    ],
  );

  useEffect(() => {
    if (
      selectedSessionId ||
      autoSelectLockedRef.current ||
      hasAutoSelectedRunningSessionRef.current ||
      sessions.length === 0
    ) {
      return;
    }

    const activeSessionId = selectMostRecentActiveSessionId({
      sessions,
      sessionStatusById,
    });
    if (!activeSessionId) {
      return;
    }

    hasAutoSelectedRunningSessionRef.current = true;
    providerSetSelectedSessionId(activeSessionId);
  }, [providerSetSelectedSessionId, selectedSessionId, sessionStatusById, sessions]);

  useEffect(() => {
    providerSetSelectedSessionId(null);
    setLocalSessionError(null);
    setDismissedDerivedErrorKey(null);
    setIsSending(false);
    autoSelectLockedRef.current = false;
    hasAutoSelectedRunningSessionRef.current = false;
    activeRunSessionIdRef.current = null;
  }, [projectSlug, providerSetSelectedSessionId]);

  useEffect(() => {
    setLocalSessionError(null);
    setDismissedDerivedErrorKey(null);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!derivedSessionError) {
      setDismissedDerivedErrorKey(null);
    }
  }, [derivedSessionError]);

  useEffect(() => {
    if (activityState.isThinking && selectedSessionId) {
      activeRunSessionIdRef.current = selectedSessionId;
      return;
    }

    if (
      !activityState.isThinking &&
      activeRunSessionIdRef.current &&
      activeRunSessionIdRef.current === selectedSessionId
    ) {
      activeRunSessionIdRef.current = null;
      onTaskComplete?.();
    }
  }, [activityState.isThinking, onTaskComplete, selectedSessionId]);

  return {
    sessions,
    sessionsLoading,
    selectedSessionId,
    setSelectedSessionId,
    selectedSession,
    selectedMessages,
    currentSessionStatus,
    sessionStatusType,
    isSessionHydrating,
    isReverted,
    usage,
    sessionError,
    clearSessionError,
    runTaskPending: runTaskMutation.isPending,
    isSending,
    setIsSending,
    isStreaming: activityState.isStreaming,
    isWaiting: activityState.isWaiting,
    isThinking: activityState.isThinking,
    hasOptimisticUserMessage,
    connection,
    lastEventTime: opencodeChat.state.lastEventTime,
    lastEventType: opencodeChat.state.lastEventType,
    lastEventId: opencodeChat.state.lastEventId,
    refetchMessages,
    refetchSessions,
    sendTask,
    deleteSession,
    revertToMessage,
    unrevertSession,
    stopGeneration,
  };
}
