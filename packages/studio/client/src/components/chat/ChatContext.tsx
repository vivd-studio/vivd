import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { POLLING_INFREQUENT } from "@/app/config/polling";
import { useOptionalPreview } from "../preview/PreviewContext";
import type {
  ChatContextValue,
  FollowupBehavior,
  ModelTier,
  QueuedFollowup,
  SessionDebugState,
} from "./chatTypes";
import {
  buildQueuedFollowupPreview,
  FOLLOWUP_BEHAVIOR_STORAGE_KEY,
  getStoredFollowupBehavior,
} from "./followupUtils";
import { useChatAttachments } from "./useChatAttachments";
import { useConfirmDialog } from "./useConfirmDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOpencodeChatController } from "@/features/opencodeChat";

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

export function useOptionalChatContext() {
  return useContext(ChatContext);
}

interface ChatProviderProps {
  children: ReactNode;
  projectSlug: string;
  version?: number;
  onTaskComplete?: () => void;
}

export function ChatProvider({
  children,
  projectSlug,
  version,
  onTaskComplete,
}: ChatProviderProps) {
  const previewContext = useOptionalPreview();
  const initialGenerationRequested =
    previewContext?.initialGenerationRequested ?? false;

  const selectorMode = previewContext?.selectorMode ?? false;
  const setSelectorMode = previewContext?.setSelectorMode;
  const selectedElement = previewContext?.selectedElement ?? null;
  const clearSelectedElement = previewContext?.clearSelectedElement;

  const {
    attachedElement,
    setAttachedElement,
    attachedImages,
    addAttachedImages,
    removeAttachedImage,
    attachedFiles,
    addAttachedFile,
    removeAttachedFile,
    buildTaskWithAttachments,
  } = useChatAttachments({
    projectSlug,
    version,
  });

  const [input, setInput] = useState("");
  const [initialGenerationStarting, setInitialGenerationStarting] = useState(false);
  const [initialGenerationFailed, setInitialGenerationFailed] = useState<string | null>(
    null,
  );
  const {
    confirmDialog,
    requestConfirm,
    resolveConfirm,
    cancelConfirmIfPending,
  } = useConfirmDialog();

  const { data: usageLimitStatus } = trpc.usage.status.useQuery(undefined, {
    refetchInterval: POLLING_INFREQUENT,
    staleTime: 10000,
  });

  const isUsageBlocked = usageLimitStatus?.blocked ?? false;

  const { data: availableModelsData } = trpc.agent.getAvailableModels.useQuery(
    undefined,
    {
      staleTime: 60000,
    },
  );
  const availableModels = (availableModelsData ?? []) as ModelTier[];
  const [selectedModel, setSelectedModelState] = useState<ModelTier | null>(null);
  const [followupBehavior, setFollowupBehaviorState] =
    useState<FollowupBehavior>(getStoredFollowupBehavior);
  const nextQueuedFollowupIdRef = useRef(0);
  const [queuedFollowupsBySessionId, setQueuedFollowupsBySessionId] = useState<
    Record<string, QueuedFollowup[]>
  >({});
  const [queuedFollowupSendingBySessionId, setQueuedFollowupSendingBySessionId] =
    useState<Record<string, string | null>>({});
  const [queuedFollowupFailedBySessionId, setQueuedFollowupFailedBySessionId] =
    useState<Record<string, string | null>>({});
  const [queuedFollowupPausedBySessionId, setQueuedFollowupPausedBySessionId] =
    useState<Record<string, boolean>>({});

  const setSelectedModel = useCallback((model: ModelTier | null) => {
    setSelectedModelState(model);
    if (model) {
      localStorage.setItem(
        "vivd-selected-model",
        JSON.stringify({ provider: model.provider, modelId: model.modelId }),
      );
    }
  }, []);

  const setFollowupBehavior = useCallback((behavior: FollowupBehavior) => {
    setFollowupBehaviorState(behavior);
    localStorage.setItem(FOLLOWUP_BEHAVIOR_STORAGE_KEY, behavior);
  }, []);

  useEffect(() => {
    if (availableModels.length === 0 || selectedModel) {
      return;
    }

    const savedModel = localStorage.getItem("vivd-selected-model");
    if (savedModel) {
      try {
        const { provider, modelId } = JSON.parse(savedModel);
        const matchingModel = availableModels.find(
          (model) =>
            model.provider === provider && model.modelId === modelId,
        );
        if (matchingModel) {
          setSelectedModelState(matchingModel);
          return;
        }
      } catch {
        // Ignore invalid local preference.
      }
    }

    setSelectedModelState(availableModels[0]);
  }, [availableModels, selectedModel]);

  const {
    sessions,
    sessionsLoading,
    selectedSessionId,
    setSelectedSessionId,
    selectedMessages,
    sessionStatusType,
    isSessionHydrating,
    isReverted,
    activeQuestionRequest,
    usage,
    sessionError,
    clearSessionError,
    runTaskPending,
    isSending,
    setIsSending,
    isStreaming,
    isWaiting,
    isThinking,
    connection,
    lastEventTime,
    lastEventType,
    lastEventId,
    refetchSessions,
    sendTask,
    replyQuestion,
    rejectQuestion,
    deleteSession,
    revertToMessage,
    unrevertSession,
    stopGeneration,
  } = useOpencodeChatController({
    projectSlug,
    version,
    selectedModel: selectedModel
      ? {
          provider: selectedModel.provider,
          modelId: selectedModel.modelId,
        }
      : null,
    onTaskComplete,
  });

  const startInitialGenerationMutation =
    trpc.agent.startInitialGeneration.useMutation();

  const queuedFollowups = selectedSessionId
    ? queuedFollowupsBySessionId[selectedSessionId] ?? []
    : [];
  const queuedFollowupSendingId = selectedSessionId
    ? queuedFollowupSendingBySessionId[selectedSessionId] ?? null
    : null;
  const queuedFollowupFailedId = selectedSessionId
    ? queuedFollowupFailedBySessionId[selectedSessionId] ?? null
    : null;
  const queuedFollowupPaused = selectedSessionId
    ? queuedFollowupPausedBySessionId[selectedSessionId] ?? false
    : false;

  const removeQueuedFollowup = useCallback((sessionId: string, id: string) => {
    setQueuedFollowupsBySessionId((current) => {
      const items = current[sessionId] ?? [];
      const nextItems = items.filter((item) => item.id !== id);
      if (nextItems.length === items.length) {
        return current;
      }
      if (nextItems.length === 0) {
        const next = { ...current };
        delete next[sessionId];
        return next;
      }
      return {
        ...current,
        [sessionId]: nextItems,
      };
    });
  }, []);

  const queueFollowup = useCallback((sessionId: string, task: string) => {
    const id = `followup-${Date.now()}-${nextQueuedFollowupIdRef.current}`;
    nextQueuedFollowupIdRef.current += 1;

    setQueuedFollowupsBySessionId((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []),
        {
          id,
          sessionId,
          task,
          preview: buildQueuedFollowupPreview(task),
        },
      ],
    }));
    setQueuedFollowupFailedBySessionId((current) => ({
      ...current,
      [sessionId]: null,
    }));
    setQueuedFollowupPausedBySessionId((current) => ({
      ...current,
      [sessionId]: false,
    }));

    toast.info("Message queued", {
      description: "It will send after the current task finishes.",
    });
    return id;
  }, []);

  const submitPreparedTask = useCallback(
    (
      task: string,
      targetSessionId: string | null,
      options?: {
        forceSend?: boolean;
        onCompleted?: (success: boolean) => void;
        onSettled?: () => void;
      },
    ) => {
      if (activeQuestionRequest || runTaskPending || isSending) {
        options?.onCompleted?.(false);
        options?.onSettled?.();
        return;
      }

      if (
        targetSessionId &&
        isThinking &&
        !options?.forceSend &&
        followupBehavior === "queue"
      ) {
        queueFollowup(targetSessionId, task);
        options?.onCompleted?.(true);
        options?.onSettled?.();
        return;
      }

      sendTask(task, targetSessionId, {
        onCompleted: options?.onCompleted,
        onSettled: options?.onSettled,
      });
    },
    [
      activeQuestionRequest,
      followupBehavior,
      isSending,
      isThinking,
      queueFollowup,
      runTaskPending,
      sendTask,
    ],
  );

  useEffect(() => {
    if (selectedElement && clearSelectedElement) {
      setAttachedElement({
        selector: selectedElement.selector,
        description: selectedElement.description,
        text: selectedElement.text,
        filename: selectedElement.filename,
        astroSourceFile: selectedElement.astroSourceFile,
        astroSourceLoc: selectedElement.astroSourceLoc,
      });
      clearSelectedElement();
    }
  }, [selectedElement, clearSelectedElement, setAttachedElement]);

  useEffect(() => {
    const pending = previewContext?.pendingChatMessage;
    const clearPending = previewContext?.clearPendingChatMessage;

    if (!pending || !clearPending) {
      return;
    }

    clearPending();

    if (pending.kind === "initialGeneration") {
      void (async () => {
        if (
          activeQuestionRequest ||
          isThinking ||
          runTaskPending ||
          isSending ||
          initialGenerationStarting
        ) {
          return;
        }

        try {
          setInitialGenerationStarting(true);
          setInitialGenerationFailed(null);
          clearSessionError();

          const result = await startInitialGenerationMutation.mutateAsync({
            projectSlug,
            version,
            model: selectedModel
              ? {
                  provider: selectedModel.provider,
                  modelId: selectedModel.modelId,
                }
              : undefined,
          });

          setSelectedSessionId(result.sessionId);
          void refetchSessions();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setInitialGenerationFailed(message);
        } finally {
          setInitialGenerationStarting(false);
        }
      })();
      return;
    }

    const { message: pendingMessage, startNewSession } = pending;
    const targetSessionId = startNewSession ? null : selectedSessionId;

    if (startNewSession) {
      setSelectedSessionId(null);
      clearSessionError();
    }

    setInput("");
    submitPreparedTask(pendingMessage, targetSessionId);
  }, [
    previewContext?.pendingChatMessage,
    previewContext?.clearPendingChatMessage,
    activeQuestionRequest,
    clearSessionError,
    initialGenerationStarting,
    isSending,
    isThinking,
    projectSlug,
    refetchSessions,
    runTaskPending,
    selectedModel,
    selectedSessionId,
    setSelectedSessionId,
    startInitialGenerationMutation,
    submitPreparedTask,
    version,
  ]);

  const retryInitialGeneration = useCallback(() => {
    if (initialGenerationStarting) return;

    previewContext?.clearPendingChatMessage?.();
    previewContext?.setChatOpen(true);
    setInitialGenerationFailed(null);

    void (async () => {
      try {
        setInitialGenerationStarting(true);
        clearSessionError();

        const result = await startInitialGenerationMutation.mutateAsync({
          projectSlug,
          version,
          model: selectedModel
            ? {
                provider: selectedModel.provider,
                modelId: selectedModel.modelId,
              }
            : undefined,
        });

        setSelectedSessionId(result.sessionId);
        void refetchSessions();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setInitialGenerationFailed(message);
      } finally {
        setInitialGenerationStarting(false);
      }
    })();
  }, [
    clearSessionError,
    initialGenerationStarting,
    previewContext,
    projectSlug,
    refetchSessions,
    selectedModel,
    setSelectedSessionId,
    startInitialGenerationMutation,
    version,
  ]);

  useEffect(() => {
    if (selectedSessionId) {
      setInitialGenerationFailed(null);
    }
  }, [selectedSessionId]);

  const handleSend = async () => {
    if (
      (!input.trim() &&
        !attachedElement &&
        attachedImages.length === 0 &&
        attachedFiles.length === 0) ||
      activeQuestionRequest ||
      runTaskPending ||
      isSending
    ) {
      return;
    }

    setIsSending(true);

    const task = await buildTaskWithAttachments(input);

    setInput("");
    setAttachedElement(null);
    clearSessionError();

    submitPreparedTask(task, selectedSessionId, {
      onSettled: () => setIsSending(false),
    });
  };

  const handleContinueSession = useCallback(() => {
    if (
      !selectedSessionId ||
      activeQuestionRequest ||
      isThinking ||
      runTaskPending ||
      isSending ||
      isUsageBlocked
    ) {
      return;
    }

    sendTask("continue", selectedSessionId);
  }, [
    selectedSessionId,
    activeQuestionRequest,
    isThinking,
    runTaskPending,
    isSending,
    isUsageBlocked,
    sendTask,
  ]);

  const handleReplyQuestion = useCallback(
    async (requestId: string, answers: string[][]) => {
      await replyQuestion(requestId, answers);
    },
    [replyQuestion],
  );

  const handleRejectQuestion = useCallback(
    async (requestId: string) => {
      await rejectQuestion(requestId);
    },
    [rejectQuestion],
  );

  const handleNewSession = useCallback(() => {
    setSelectedSessionId(null);
    setInput("");
    clearSessionError();
  }, [clearSessionError, setSelectedSessionId]);

  useEffect(() => {
    const pendingNewSessionRequestId =
      previewContext?.pendingNewSessionRequestId;
    const clearPendingNewSessionRequest =
      previewContext?.clearPendingNewSessionRequest;

    if (!pendingNewSessionRequestId || !clearPendingNewSessionRequest) {
      return;
    }

    handleNewSession();
    clearPendingNewSessionRequest();
  }, [
    handleNewSession,
    previewContext?.pendingNewSessionRequestId,
    previewContext?.clearPendingNewSessionRequest,
  ]);

  const handleDeleteSession = useCallback(
    async (e: MouseEvent, sessionId: string) => {
      e.stopPropagation();
      const ok = await requestConfirm({
        title: "Delete this session?",
        description: "This will permanently delete the session and its messages.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) return;
      await deleteSession(sessionId);
    },
    [deleteSession, requestConfirm],
  );

  const handleRevert = useCallback(
    async (messageId: string) => {
      if (!selectedSessionId) return;
      const ok = await requestConfirm({
        title: "Revert changes from this task?",
        description: "This will undo file changes made by the agent.",
        confirmLabel: "Revert",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) return;
      try {
        await revertToMessage(messageId);
      } catch {
        // Handled by mutation onError.
      }
    },
    [requestConfirm, revertToMessage, selectedSessionId],
  );

  const handleUnrevert = useCallback(async () => {
    try {
      await unrevertSession();
    } catch {
      // Handled by mutation onError.
    }
  }, [unrevertSession]);

  const handleStopGeneration = useCallback(() => {
    if (selectedSessionId && (queuedFollowupsBySessionId[selectedSessionId]?.length ?? 0) > 0) {
      setQueuedFollowupPausedBySessionId((current) => ({
        ...current,
        [selectedSessionId]: true,
      }));
    }
    stopGeneration();
  }, [queuedFollowupsBySessionId, selectedSessionId, stopGeneration]);

  const handleSendQueuedFollowup = useCallback(
    (id: string) => {
      if (!selectedSessionId) return;
      if (queuedFollowupSendingBySessionId[selectedSessionId]) return;

      const item = (queuedFollowupsBySessionId[selectedSessionId] ?? []).find(
        (entry) => entry.id === id,
      );
      if (!item) return;

      setQueuedFollowupPausedBySessionId((current) => ({
        ...current,
        [selectedSessionId]: false,
      }));
      setQueuedFollowupFailedBySessionId((current) => ({
        ...current,
        [selectedSessionId]: null,
      }));
      setQueuedFollowupSendingBySessionId((current) => ({
        ...current,
        [selectedSessionId]: id,
      }));

      submitPreparedTask(item.task, selectedSessionId, {
        forceSend: true,
        onCompleted: (success) => {
          if (success) {
            removeQueuedFollowup(selectedSessionId, id);
            return;
          }
          setQueuedFollowupFailedBySessionId((current) => ({
            ...current,
            [selectedSessionId]: id,
          }));
        },
        onSettled: () => {
          setQueuedFollowupSendingBySessionId((current) => ({
            ...current,
            [selectedSessionId]:
              current[selectedSessionId] === id ? null : current[selectedSessionId],
          }));
        },
      });
    },
    [
      queuedFollowupSendingBySessionId,
      queuedFollowupsBySessionId,
      removeQueuedFollowup,
      selectedSessionId,
      submitPreparedTask,
    ],
  );

  const handleEditQueuedFollowup = useCallback(
    (id: string) => {
      if (!selectedSessionId) return;
      if (queuedFollowupSendingBySessionId[selectedSessionId]) return;

      const item = (queuedFollowupsBySessionId[selectedSessionId] ?? []).find(
        (entry) => entry.id === id,
      );
      if (!item) return;

      removeQueuedFollowup(selectedSessionId, id);
      setQueuedFollowupFailedBySessionId((current) => ({
        ...current,
        [selectedSessionId]:
          current[selectedSessionId] === id ? null : current[selectedSessionId],
      }));
      setQueuedFollowupPausedBySessionId((current) => ({
        ...current,
        [selectedSessionId]: false,
      }));
      setInput(item.task);
    },
    [
      queuedFollowupSendingBySessionId,
      queuedFollowupsBySessionId,
      removeQueuedFollowup,
      selectedSessionId,
    ],
  );

  useEffect(() => {
    if (!selectedSessionId) return;

    const item = queuedFollowupsBySessionId[selectedSessionId]?.[0];
    if (!item) return;
    if (queuedFollowupSendingBySessionId[selectedSessionId]) return;
    if (queuedFollowupFailedBySessionId[selectedSessionId] === item.id) return;
    if (queuedFollowupPausedBySessionId[selectedSessionId]) return;
    if (
      activeQuestionRequest ||
      isThinking ||
      runTaskPending ||
      isSending ||
      isUsageBlocked
    ) {
      return;
    }

    setQueuedFollowupSendingBySessionId((current) => ({
      ...current,
      [selectedSessionId]: item.id,
    }));

    submitPreparedTask(item.task, selectedSessionId, {
      onCompleted: (success) => {
        if (success) {
          removeQueuedFollowup(selectedSessionId, item.id);
          return;
        }
        setQueuedFollowupFailedBySessionId((current) => ({
          ...current,
          [selectedSessionId]: item.id,
        }));
      },
      onSettled: () => {
        setQueuedFollowupSendingBySessionId((current) => ({
          ...current,
          [selectedSessionId]:
            current[selectedSessionId] === item.id
              ? null
              : current[selectedSessionId],
        }));
      },
    });
  }, [
    activeQuestionRequest,
    isSending,
    isThinking,
    isUsageBlocked,
    queuedFollowupFailedBySessionId,
    queuedFollowupPausedBySessionId,
    queuedFollowupSendingBySessionId,
    queuedFollowupsBySessionId,
    removeQueuedFollowup,
    runTaskPending,
    selectedSessionId,
    submitPreparedTask,
  ]);

  const sessionDebugState: SessionDebugState = {
    selectedSessionId,
    isStreaming,
    isWaiting,
    isThinking,
    streamingPartsCount: 0,
    messagesCount: selectedMessages.length,
    sseConnected: connection.state === "connected",
    lastEventTime: lastEventTime ? new Date(lastEventTime).toISOString() : null,
    lastEventType,
    lastEventId,
    sessionError,
    sessionStatus: sessionStatusType,
    usage,
  };

  const value: ChatContextValue = {
    projectSlug,
    version,
    sessions,
    sessionsLoading,
    selectedSessionId,
    setSelectedSessionId,
    isSessionHydrating,
    messageCount: selectedMessages.length,
    isStreaming,
    isWaiting,
    isThinking,
    input,
    setInput,
    attachedElement,
    setAttachedElement,
    attachedImages,
    addAttachedImages,
    removeAttachedImage,
    attachedFiles,
    addAttachedFile,
    removeAttachedFile,
    followupBehavior,
    setFollowupBehavior,
    queuedFollowups,
    queuedFollowupSendingId,
    selectorMode,
    setSelectorMode,
    selectorModeAvailable: !!setSelectorMode,
    isReverted,
    isLoading: runTaskPending || isSending || initialGenerationStarting,
    activeQuestionRequest,
    sessionDebugState,
    sessionError,
    clearSessionError,
    usageLimitStatus: usageLimitStatus ?? null,
    isUsageBlocked,
    availableModels,
    selectedModel,
    setSelectedModel,
    initialGenerationRequested,
    initialGenerationStarting,
    initialGenerationFailed,
    retryInitialGeneration,
    handleSend,
    handleReplyQuestion,
    handleRejectQuestion,
    handleContinueSession,
    handleNewSession,
    handleDeleteSession,
    handleRevert,
    handleUnrevert,
    handleStopGeneration,
    handleSendQueuedFollowup,
    handleEditQueuedFollowup,
  };

  return (
    <>
      <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            cancelConfirmIfPending();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            {confirmDialog.description ? (
              <AlertDialogDescription>
                {confirmDialog.description}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveConfirm(false)}>
              {confirmDialog.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmDialog.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => resolveConfirm(true)}
            >
              {confirmDialog.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
