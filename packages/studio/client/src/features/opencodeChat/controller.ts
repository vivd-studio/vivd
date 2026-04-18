import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { deriveOpencodeControllerState } from "./controllerState";
import { useOpencodeChat } from "./provider";
import { sanitizeSessionError } from "./sync/errorPolicy";
import { resolveCanonicalUserMessageId } from "./sync/optimisticMessages";
import {
  isActiveSessionStatus,
  isTerminalSessionStatusType,
} from "./runtime";
import type { SanitizedSessionError } from "./sync/errorPolicy";

type ControllerModel = {
  provider: string;
  modelId: string;
  variant?: string;
} | null;

type UseOpencodeChatControllerArgs = {
  projectSlug: string;
  version?: number;
  selectedModel: ControllerModel;
  initialSelectedSessionId?: string | null;
  initialGenerationRequested?: boolean;
  onTaskComplete?: () => void;
};

type PendingSessionStart = {
  requestId: number;
  cancelled: boolean;
  cleanupRequested: boolean;
  sessionId: string | null;
};

const STALE_ACTIVE_SESSION_RECONCILE_MS = 8_000;
const TERMINAL_PENDING_ASSISTANT_RECONCILE_MS = 1_500;
// Allow stopGeneration to cancel a just-created session before its first prompt dispatch.
const NEW_SESSION_DISPATCH_GRACE_MS = 16;

export function useOpencodeChatController({
  projectSlug,
  version,
  selectedModel,
  initialSelectedSessionId,
  initialGenerationRequested = false,
  onTaskComplete,
}: UseOpencodeChatControllerArgs) {
  const opencodeChat = useOpencodeChat();
  const providerSetSelectedSessionId = opencodeChat.setSelectedSessionId;
  const sessionStatusById = opencodeChat.state.sessionStatusById;
  const questionRequestsBySessionId = opencodeChat.questionRequestsBySessionId;
  const permissionRequestsBySessionId =
    opencodeChat.permissionRequestsBySessionId;
  const connection = opencodeChat.state.connection;
  const [localSessionError, setLocalSessionError] =
    useState<SanitizedSessionError | null>(null);
  const [dismissedDerivedErrorKey, setDismissedDerivedErrorKey] = useState<
    string | null
  >(null);
  const [isSending, setIsSending] = useState(false);
  const [suppressedSessionId, setSuppressedSessionId] = useState<string | null>(
    null,
  );
  const autoSelectLockedRef = useRef(false);
  const hasAutoSelectedRunningSessionRef = useRef(false);
  const activeRunSessionIdRef = useRef<string | null>(null);
  const nextPendingSessionStartIdRef = useRef(0);
  const pendingSessionStartRef = useRef<PendingSessionStart | null>(null);
  const staleRunningToolHealRef = useRef<string | null>(null);
  const terminalPendingAssistantHealRef = useRef<string | null>(null);
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
            ...(selectedModel.variant ? { variant: selectedModel.variant } : {}),
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
      setSuppressedSessionId(null);
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
  const respondPermissionMutation = trpc.agentChat.respondPermission.useMutation({
    onSuccess: () => {
      refetchSessions();
    },
    onError: (error) => {
      toast.error("Permission response failed", { description: error.message });
    },
  });

  const controllerState = useMemo(
    () =>
      deriveOpencodeControllerState({
        sessions,
        selectedSessionId,
        selectedMessages,
        sessionStatusById,
        questionRequestsBySessionId,
        permissionRequestsBySessionId,
        selectedSessionStatus: currentSessionStatus,
        selectedSessionIsError: sessionMessagesIsError,
        selectedSessionError: sessionMessagesError,
        connectionState: connection.state,
        connectionMessage: connection.message,
        hasOptimisticUserMessage,
        isSubmitting:
          createSessionMutation.isPending ||
          runTaskMutation.isPending ||
          isSending,
        suppressedSessionId,
      }),
    [
      connection.message,
      connection.state,
      createSessionMutation.isPending,
      currentSessionStatus,
      hasOptimisticUserMessage,
      isSending,
      permissionRequestsBySessionId,
      questionRequestsBySessionId,
      runTaskMutation.isPending,
      selectedMessages,
      selectedSessionId,
      sessionMessagesError,
      sessionMessagesIsError,
      sessionStatusById,
      sessions,
      suppressedSessionId,
    ],
  );
  const {
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
  } = controllerState;

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
      selectedSessionId,
      setSelectedSessionId,
    ],
  );

  const sendTask = useCallback(
    (
      task: string,
      targetSessionId: string | null,
      options?: { onCompleted?: (success: boolean) => void; onSettled?: () => void },
    ) => {
      if (hasBlockingRequest) {
        toast.info("Resolve the pending approval first");
        options?.onCompleted?.(false);
        options?.onSettled?.();
        return;
      }

      setLocalSessionError(null);
      setDismissedDerivedErrorKey(null);
      if (targetSessionId) {
        setSuppressedSessionId((current) =>
          current === targetSessionId ? null : current,
        );
      } else {
        setSuppressedSessionId(null);
      }

      void (async () => {
        let pendingRequestId: number | null = null;
        let pendingStart: PendingSessionStart | null = null;
        let preservePendingStartRef = false;

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
            cleanupRequested: false,
            sessionId: null,
          };
          pendingSessionStartRef.current = pendingStart;

          const created = await createSessionMutation.mutateAsync({
            projectSlug,
            version,
          });
          pendingStart.sessionId = created.sessionId;

          if (pendingStart.cancelled) {
            if (!pendingStart.cleanupRequested) {
              pendingStart.cleanupRequested = true;
              await deleteSessionMutation
                .mutateAsync({
                  sessionId: created.sessionId,
                  projectSlug,
                  version,
                })
                .catch(() => undefined);
            }
            setSelectedSessionId(null);
            options?.onCompleted?.(false);
            return;
          }

          if (created.sessionId !== selectedSessionId) {
            setSelectedSessionId(created.sessionId);
          }

          await new Promise<void>((resolve) => {
            setTimeout(resolve, NEW_SESSION_DISPATCH_GRACE_MS);
          });

          if (pendingStart.cancelled) {
            if (!pendingStart.cleanupRequested) {
              pendingStart.cleanupRequested = true;
              await deleteSessionMutation
                .mutateAsync({
                  sessionId: created.sessionId,
                  projectSlug,
                  version,
                })
                .catch(() => undefined);
            }
            setSelectedSessionId(null);
            options?.onCompleted?.(false);
            return;
          }

          const success = await dispatchTaskToSession(task, created.sessionId);
          preservePendingStartRef = success;
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
            if (
              !preservePendingStartRef ||
              !pendingStart?.sessionId ||
              pendingStart.cancelled
            ) {
              pendingSessionStartRef.current = null;
            }
          }
          options?.onSettled?.();
        }
      })();
    },
    [
      hasBlockingRequest,
      createSessionMutation,
      deleteSessionMutation,
      dispatchTaskToSession,
      projectSlug,
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
        setSuppressedSessionId(pendingStart.sessionId);
      }
      if (pendingStart.sessionId) {
        abortSessionMutation.mutate({
          sessionId: pendingStart.sessionId,
          projectSlug,
          version,
        });
        if (!pendingStart.cleanupRequested) {
          pendingStart.cleanupRequested = true;
          void deleteSessionMutation
            .mutateAsync({
              sessionId: pendingStart.sessionId,
              projectSlug,
              version,
            })
            .catch(() => undefined);
        }
        setSelectedSessionId(null);
      }
      return;
    }

    if (!selectedSessionId) return;
    setSuppressedSessionId(selectedSessionId);
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

  const respondPermission = useCallback(
    async (
      requestId: string,
      sessionId: string,
      response: "once" | "always" | "reject",
    ) => {
      await respondPermissionMutation.mutateAsync({
        projectSlug,
        version,
        requestId,
        sessionId,
        response,
      });
    },
    [projectSlug, respondPermissionMutation, version],
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

  useEffect(() => {
    if (
      !selectedSessionId ||
      suppressedSessionId !== selectedSessionId ||
      !isActiveSessionStatus(currentSessionStatus)
    ) {
      return;
    }

    setSuppressedSessionId(null);
  }, [currentSessionStatus, selectedSessionId, suppressedSessionId]);

  useEffect(() => {
    const pendingStart = pendingSessionStartRef.current;
    if (!pendingStart?.sessionId || pendingStart.cancelled) {
      return;
    }

    if (pendingStart.sessionId !== selectedSessionId) {
      return;
    }

    if (
      !sessionShowsRunActivity &&
      !isTerminalSessionStatusType(sessionStatusType)
    ) {
      return;
    }

    pendingSessionStartRef.current = null;
  }, [selectedSessionId, sessionShowsRunActivity, sessionStatusType]);

  useEffect(() => {
    if (
      !selectedSessionId ||
      !terminalPendingAssistantMessageId ||
      isSessionHydrating ||
      connection.state !== "connected"
    ) {
      if (!terminalPendingAssistantMessageId) {
        terminalPendingAssistantHealRef.current = null;
      }
      return;
    }

    const healKey = [
      selectedSessionId,
      terminalPendingAssistantMessageId,
      opencodeChat.state.lastEventId ?? "none",
    ].join(":");
    if (terminalPendingAssistantHealRef.current === healKey) {
      return;
    }

    terminalPendingAssistantHealRef.current = healKey;
    const timer = window.setTimeout(() => {
      void refetchSelectedSessionSnapshot();
    }, TERMINAL_PENDING_ASSISTANT_RECONCILE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    connection.state,
    isSessionHydrating,
    opencodeChat.state.lastEventId,
    refetchSelectedSessionSnapshot,
    selectedSessionId,
    terminalPendingAssistantMessageId,
  ]);

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

    // During scratch initial generation, an unrelated hydrated session must not
    // steal focus before the real initial-generation session is created.
    const fallbackSessionId = null;
    const nextSessionId = attentionSessionId ?? fallbackSessionId;

    if (!nextSessionId) {
      return;
    }

    hasAutoSelectedRunningSessionRef.current = true;
    providerSetSelectedSessionId(nextSessionId);
  }, [
    attentionSessionId,
    initialGenerationRequested,
    initialSelectedSessionId,
    providerSetSelectedSessionId,
    selectedSessionId,
    sessions,
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
    setSuppressedSessionId(null);
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
    if (selectedSessionId && sessionShowsRunActivity) {
      activeRunSessionIdRef.current = selectedSessionId;
      return;
    }

    if (
      activeRunSessionIdRef.current &&
      activeRunSessionIdRef.current === selectedSessionId &&
      isTerminalSessionStatusType(sessionStatusType)
    ) {
      activeRunSessionIdRef.current = null;
      onTaskComplete?.();
    }
  }, [
    currentSessionStatus,
    onTaskComplete,
    selectedSessionId,
    sessionShowsRunActivity,
    sessionStatusType,
  ]);

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
    activePermissionRequest,
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
    respondPermission,
    deleteSession,
    revertToMessage,
    unrevertSession,
    stopGeneration,
  };
}
