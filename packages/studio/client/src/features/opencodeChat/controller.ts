import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { calculateUsageFromSessionMessages } from "./render/sessionMetrics";
import { useOpencodeChat } from "./provider";
import { sanitizeSessionError } from "./sync/errorPolicy";
import { resolveCanonicalUserMessageId } from "./sync/optimisticMessages";
import {
  buildDerivedSessionError,
  deriveChatActivityState,
  findStaleRunningToolState,
  selectMostRecentAttentionSessionId,
} from "./runtime";
import { sessionQuestionRequest } from "./questions/requestTree";
import type { SanitizedSessionError } from "./sync/errorPolicy";

type ControllerModel = {
  provider: string;
  modelId: string;
} | null;

type UseOpencodeChatControllerArgs = {
  projectSlug: string;
  version?: number;
  selectedModel: ControllerModel;
  initialSelectedSessionId?: string | null;
  onTaskComplete?: () => void;
};

type PendingSessionStart = {
  requestId: number;
  cancelled: boolean;
  sessionId: string | null;
};

const STALE_ACTIVE_SESSION_RECONCILE_MS = 8_000;

export function useOpencodeChatController({
  projectSlug,
  version,
  selectedModel,
  initialSelectedSessionId,
  onTaskComplete,
}: UseOpencodeChatControllerArgs) {
  const opencodeChat = useOpencodeChat();
  const providerSetSelectedSessionId = opencodeChat.setSelectedSessionId;
  const sessionStatusById = opencodeChat.state.sessionStatusById;
  const questionRequestsBySessionId = opencodeChat.questionRequestsBySessionId;
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
  const nextPendingSessionStartIdRef = useRef(0);
  const pendingSessionStartRef = useRef<PendingSessionStart | null>(null);
  const staleRunningToolHealRef = useRef<string | null>(null);
  const staleActiveSessionIdRef = useRef<string | null>(null);
  const staleActiveSessionObservedAtRef = useRef<number | null>(null);
  const staleActiveSessionHealAtRef = useRef<number | null>(null);

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
  const refetchSelectedSessionSnapshot = useCallback(async () => {
    await Promise.allSettled([refetchSessions(), refetchMessages()]);
  }, [refetchMessages, refetchSessions]);

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
  const attentionSessionId = useMemo(
    () =>
      selectMostRecentAttentionSessionId({
        sessions,
        sessionStatusById,
        questionRequestsBySessionId,
      }),
    [questionRequestsBySessionId, sessionStatusById, sessions],
  );
  const activeQuestionRequest = useMemo(
    () =>
      sessionQuestionRequest(
        sessions,
        questionRequestsBySessionId,
        selectedSessionId ?? attentionSessionId,
      ) ?? null,
    [attentionSessionId, questionRequestsBySessionId, selectedSessionId, sessions],
  );
  const isReverted = Boolean(selectedSession?.revert);
  const usage = useMemo(
    () => calculateUsageFromSessionMessages(selectedMessages),
    [selectedMessages],
  );
  const staleRunningToolState = useMemo(
    () => findStaleRunningToolState(selectedMessages),
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
  const createSessionMutation = trpc.agent.createSession.useMutation();
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
      if (data.reverted === false) {
        if (
          "reason" in data &&
          data.reason === "missing_snapshot_history"
        ) {
          toast.info("Revert unavailable", {
            description:
              "This older session depends on snapshot history that is no longer available on this Studio. New changes should be tracked again, but this specific revert cannot be reconstructed.",
          });
          return;
        }

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
    onSuccess: async () => {
      await refetchSelectedSessionSnapshot();
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
  const replyQuestionMutation = trpc.agentChat.replyQuestion.useMutation({
    onSuccess: () => {
      refetchSessions();
    },
    onError: (error) => {
      toast.error("Question reply failed", { description: error.message });
    },
  });
  const rejectQuestionMutation = trpc.agentChat.rejectQuestion.useMutation({
    onSuccess: () => {
      refetchSessions();
    },
    onError: (error) => {
      toast.error("Question rejection failed", { description: error.message });
    },
  });

  const dispatchTaskToSession = useCallback(
    async (task: string, targetSessionId: string) => {
      const optimisticMessageId = opencodeChat.addOptimisticUserMessage({
        content: task,
        sessionId: targetSessionId,
        createdAt: Date.now(),
      });

      try {
        const data = await runTaskMutation.mutateAsync(
          buildRunTaskPayload(task, targetSessionId),
        );

        if (!data.sessionId) {
          throw new Error("OpenCode did not return a session id.");
        }

        opencodeChat.assignOptimisticUserMessageSession(
          optimisticMessageId,
          data.sessionId,
        );

        if (data.sessionId !== selectedSessionId) {
          setSelectedSessionId(data.sessionId);
        }

        if (targetSessionId === selectedSessionId) {
          await refetchSelectedSessionSnapshot();
        } else {
          await refetchSessions();
        }
        return true;
      } catch (error) {
        opencodeChat.removeOptimisticUserMessage(optimisticMessageId);
        setLocalSessionError(
          sanitizeSessionError({
            type: "task",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        setDismissedDerivedErrorKey(null);
        return false;
      }
    },
    [
      opencodeChat,
      runTaskMutation,
      buildRunTaskPayload,
      refetchSelectedSessionSnapshot,
      selectedSessionId,
      setSelectedSessionId,
      refetchSessions,
    ],
  );

  const sendTask = useCallback(
    (
      task: string,
      targetSessionId: string | null,
      options?: { onCompleted?: (success: boolean) => void; onSettled?: () => void },
    ) => {
      if (activeQuestionRequest) {
        toast.info("Answer the pending question first");
        options?.onCompleted?.(false);
        options?.onSettled?.();
        return;
      }

      setLocalSessionError(null);
      setDismissedDerivedErrorKey(null);

      void (async () => {
        let pendingRequestId: number | null = null;
        let pendingStart: PendingSessionStart | null = null;

        try {
          if (targetSessionId) {
            const success = await dispatchTaskToSession(task, targetSessionId);
            options?.onCompleted?.(success);
            return;
          }

          pendingRequestId = nextPendingSessionStartIdRef.current;
          nextPendingSessionStartIdRef.current += 1;
          pendingStart = {
            requestId: pendingRequestId,
            cancelled: false,
            sessionId: null,
          };
          pendingSessionStartRef.current = pendingStart;

          const created = await createSessionMutation.mutateAsync({
            projectSlug,
            version,
          });
          pendingStart.sessionId = created.sessionId;

          if (pendingStart.cancelled) {
            await deleteSessionMutation
              .mutateAsync({
                sessionId: created.sessionId,
                projectSlug,
                version,
              })
              .catch(() => undefined);
            setSelectedSessionId(null);
            options?.onCompleted?.(false);
            return;
          }

          if (created.sessionId !== selectedSessionId) {
            setSelectedSessionId(created.sessionId);
          }
          await refetchSessions();

          if (pendingStart.cancelled) {
            await deleteSessionMutation
              .mutateAsync({
                sessionId: created.sessionId,
                projectSlug,
                version,
              })
              .catch(() => undefined);
            setSelectedSessionId(null);
            options?.onCompleted?.(false);
            return;
          }

          const success = await dispatchTaskToSession(task, created.sessionId);
          options?.onCompleted?.(success);
        } catch (error) {
          if (!pendingStart?.cancelled) {
            setLocalSessionError(
              sanitizeSessionError({
                type: "task",
                message: error instanceof Error ? error.message : String(error),
              }),
            );
            setDismissedDerivedErrorKey(null);
          }
          options?.onCompleted?.(false);
        } finally {
          if (
            pendingRequestId != null &&
            pendingSessionStartRef.current?.requestId === pendingRequestId
          ) {
            pendingSessionStartRef.current = null;
          }
          options?.onSettled?.();
        }
      })();
    },
    [
      activeQuestionRequest,
      createSessionMutation,
      deleteSessionMutation,
      dispatchTaskToSession,
      projectSlug,
      refetchSessions,
      selectedSessionId,
      setSelectedSessionId,
      version,
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
      const resolvedMessageId =
        resolveCanonicalUserMessageId(selectedMessages, messageId) ?? messageId;
      await revertMutation.mutateAsync({
        sessionId: selectedSessionId,
        messageId: resolvedMessageId,
        projectSlug,
        version,
      });
    },
    [projectSlug, revertMutation, selectedMessages, selectedSessionId, version],
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
    const pendingStart = pendingSessionStartRef.current;
    if (pendingStart) {
      pendingStart.cancelled = true;
      if (pendingStart.sessionId) {
        abortSessionMutation.mutate({
          sessionId: pendingStart.sessionId,
          projectSlug,
          version,
        });
      }
      return;
    }

    if (!selectedSessionId) return;
    abortSessionMutation.mutate({
      sessionId: selectedSessionId,
      projectSlug,
      version,
    });
  }, [abortSessionMutation, projectSlug, selectedSessionId, version]);

  const replyQuestion = useCallback(
    async (requestId: string, answers: string[][]) => {
      await replyQuestionMutation.mutateAsync({
        projectSlug,
        version,
        requestId,
        answers,
      });
    },
    [projectSlug, replyQuestionMutation, version],
  );

  const rejectQuestion = useCallback(
    async (requestId: string) => {
      await rejectQuestionMutation.mutateAsync({
        projectSlug,
        version,
        requestId,
      });
    },
    [projectSlug, rejectQuestionMutation, version],
  );

  const derivedSessionError = useMemo(
    () =>
      buildDerivedSessionError({
        selectedSessionId,
        messages: selectedMessages,
        sessionMessagesIsError,
        sessionMessagesError,
        sessionStatus: currentSessionStatus,
        connectionState: connection.state,
        connectionMessage: connection.message,
      }),
    [
      selectedSessionId,
      selectedMessages,
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
        isSubmitting:
          createSessionMutation.isPending ||
          runTaskMutation.isPending ||
          isSending,
      }),
    [
      selectedMessages,
      currentSessionStatus,
      hasOptimisticUserMessage,
      createSessionMutation.isPending,
      runTaskMutation.isPending,
      isSending,
    ],
  );

  useEffect(() => {
    if (!activityState.isThinking || !selectedSessionId) {
      staleActiveSessionIdRef.current = null;
      staleActiveSessionObservedAtRef.current = null;
      staleActiveSessionHealAtRef.current = null;
      return;
    }

    if (staleActiveSessionIdRef.current === selectedSessionId) {
      return;
    }

    staleActiveSessionIdRef.current = selectedSessionId;
    staleActiveSessionObservedAtRef.current = Date.now();
    staleActiveSessionHealAtRef.current = null;
  }, [activityState.isThinking, selectedSessionId]);

  useEffect(() => {
    if (
      initialSelectedSessionId ||
      selectedSessionId ||
      autoSelectLockedRef.current ||
      hasAutoSelectedRunningSessionRef.current ||
      sessions.length === 0
    ) {
      return;
    }

    if (!attentionSessionId) {
      return;
    }

    hasAutoSelectedRunningSessionRef.current = true;
    providerSetSelectedSessionId(attentionSessionId);
  }, [
    attentionSessionId,
    initialSelectedSessionId,
    providerSetSelectedSessionId,
    selectedSessionId,
  ]);

  useEffect(() => {
    providerSetSelectedSessionId(initialSelectedSessionId ?? null);
    setLocalSessionError(null);
    setDismissedDerivedErrorKey(null);
    setIsSending(false);
    autoSelectLockedRef.current = Boolean(initialSelectedSessionId);
    hasAutoSelectedRunningSessionRef.current = false;
    activeRunSessionIdRef.current = null;
    pendingSessionStartRef.current = null;
  }, [initialSelectedSessionId, projectSlug, providerSetSelectedSessionId]);

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
    if (
      !selectedSessionId ||
      !staleRunningToolState ||
      isSessionHydrating ||
      connection.state !== "connected"
    ) {
      if (!staleRunningToolState) {
        staleRunningToolHealRef.current = null;
      }
      return;
    }

    const healKey = [
      selectedSessionId,
      staleRunningToolState.messageId,
      staleRunningToolState.reason,
      opencodeChat.state.lastEventId ?? "none",
    ].join(":");
    if (staleRunningToolHealRef.current === healKey) {
      return;
    }

    staleRunningToolHealRef.current = healKey;
    void refetchMessages();
  }, [
    connection.state,
    isSessionHydrating,
    opencodeChat.state.lastEventId,
    refetchMessages,
    selectedSessionId,
    staleRunningToolState,
  ]);

  useEffect(() => {
    if (
      !selectedSessionId ||
      !activityState.isThinking ||
      isSessionHydrating ||
      connection.state !== "connected"
    ) {
      return;
    }

    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return;
    }

    const observedAt = staleActiveSessionObservedAtRef.current;
    if (observedAt == null) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const schedule = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        timer = window.setTimeout(schedule, STALE_ACTIVE_SESSION_RECONCILE_MS);
        return;
      }

      const lastEventTime = opencodeChat.state.lastEventTime ?? 0;
      const lastHealAt = staleActiveSessionHealAtRef.current ?? 0;
      const anchor = Math.max(observedAt, lastEventTime, lastHealAt);
      const remainingMs = Math.max(
        0,
        anchor + STALE_ACTIVE_SESSION_RECONCILE_MS - Date.now(),
      );

      timer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        staleActiveSessionHealAtRef.current = Date.now();
        void refetchSelectedSessionSnapshot().finally(() => {
          if (cancelled) {
            return;
          }
          schedule();
        });
      }, remainingMs);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [
    activityState.isThinking,
    connection.state,
    isSessionHydrating,
    opencodeChat.state.lastEventTime,
    refetchSelectedSessionSnapshot,
    selectedSessionId,
  ]);

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
    activeQuestionRequest,
    sessionError,
    clearSessionError,
    runTaskPending:
      createSessionMutation.isPending || runTaskMutation.isPending,
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
    replyQuestion,
    rejectQuestion,
    deleteSession,
    revertToMessage,
    unrevertSession,
    stopGeneration,
  };
}
