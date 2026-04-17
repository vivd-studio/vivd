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
import { DEFAULT_STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS } from "@studio/shared/opencodeContextPolicy";
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
const SELECTED_MODEL_STORAGE_KEY = "vivd-selected-model";

type StoredModelPreference = {
  tier?: string;
  provider?: string;
  modelId?: string;
  variant?: string;
};

function readModelString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function resolveMatchingModel(
  availableModels: ModelTier[],
  preference: StoredModelPreference,
): ModelTier | null {
  const { tier, provider, modelId, variant } = preference;
  if (!provider || !modelId) {
    return null;
  }

  return (
    availableModels.find(
      (model) =>
        typeof tier === "string" &&
        model.tier === tier &&
        model.provider === provider &&
        model.modelId === modelId &&
        (model.variant || undefined) === (variant || undefined),
    ) ??
    availableModels.find(
      (model) =>
        model.provider === provider &&
        model.modelId === modelId &&
        (model.variant || undefined) === (variant || undefined),
    ) ??
    availableModels.find(
      (model) => model.provider === provider && model.modelId === modelId,
    ) ??
    null
  );
}

function getStoredSelectedModelPreference(
  availableModels: ModelTier[],
): ModelTier | null {
  const savedModel = localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
  if (!savedModel) {
    return null;
  }

  try {
    return resolveMatchingModel(
      availableModels,
      JSON.parse(savedModel) as StoredModelPreference,
    );
  } catch {
    return null;
  }
}

function getSelectedSessionModel(
  selectedMessages: Array<{ info?: Record<string, unknown> }>,
  availableModels: ModelTier[],
): ModelTier | null {
  for (let index = selectedMessages.length - 1; index >= 0; index -= 1) {
    const info = selectedMessages[index]?.info;
    if (info?.role !== "assistant") {
      continue;
    }

    const nestedModel = (info.model as Record<string, unknown> | undefined) ?? {};
    const provider = readModelString(
      info.providerID,
      info.providerId,
      nestedModel.providerID,
      nestedModel.providerId,
    );
    const modelId = readModelString(
      info.modelID,
      info.modelId,
      nestedModel.modelID,
      nestedModel.modelId,
    );
    const variant = readModelString(info.variant, nestedModel.variant);
    const tier = readModelString(info.tier, nestedModel.tier);
    const matchingModel = resolveMatchingModel(availableModels, {
      tier,
      provider,
      modelId,
      variant,
    });
    if (matchingModel) {
      return matchingModel;
    }
  }

  return null;
}

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
  const requestedInitialSessionId =
    previewContext?.requestedInitialSessionId ?? null;

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
  const autoInitialGenerationAttemptedRef = useRef(false);
  const pendingInitialGenerationDefaultModelRef = useRef(false);
  const [isPreparingSend, setIsPreparingSend] = useState(false);
  const isPreparingSendRef = useRef(false);
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
  const { data: runtimeConfigData } = trpc.agent.getRuntimeConfig.useQuery(
    undefined,
    {
      staleTime: 60000,
    },
  );
  const availableModels = (availableModelsData ?? []) as ModelTier[];
  const softContextLimitTokens =
    runtimeConfigData?.softContextLimitTokens ??
    DEFAULT_STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
  const [selectedModel, setSelectedModelState] = useState<ModelTier | null>(null);
  const selectedModelSessionIdRef = useRef<string | null | undefined>(undefined);
  const pendingSessionModelHydrationRef = useRef<string | null>(null);
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

  const persistSelectedModelPreference = useCallback((model: ModelTier) => {
    localStorage.setItem(
      SELECTED_MODEL_STORAGE_KEY,
      JSON.stringify({
        tier: model.tier,
        provider: model.provider,
        modelId: model.modelId,
        ...(model.variant ? { variant: model.variant } : {}),
      }),
    );
  }, []);

  const setSelectedModel = useCallback((model: ModelTier | null) => {
    pendingInitialGenerationDefaultModelRef.current = false;
    setSelectedModelState(model);
    if (model) {
      persistSelectedModelPreference(model);
    }
  }, [persistSelectedModelPreference]);

  const setFollowupBehavior = useCallback((behavior: FollowupBehavior) => {
    setFollowupBehaviorState(behavior);
    localStorage.setItem(FOLLOWUP_BEHAVIOR_STORAGE_KEY, behavior);
  }, []);

  const resolveInitialGenerationModel = useCallback(() => {
    if (selectedModel) {
      return {
        provider: selectedModel.provider,
        modelId: selectedModel.modelId,
        ...(selectedModel.variant ? { variant: selectedModel.variant } : {}),
      };
    }

    const defaultModel = availableModels[0];
    if (defaultModel) {
      setSelectedModelState(defaultModel);
      return {
        provider: defaultModel.provider,
        modelId: defaultModel.modelId,
        ...(defaultModel.variant ? { variant: defaultModel.variant } : {}),
      };
    }

    pendingInitialGenerationDefaultModelRef.current = true;
    return undefined;
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
    activePermissionRequest,
    usage,
    sessionError,
    clearSessionError,
    runTaskPending,
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
    respondPermission,
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
          ...(selectedModel.variant ? { variant: selectedModel.variant } : {}),
        }
      : null,
    initialSelectedSessionId: requestedInitialSessionId,
    initialGenerationRequested,
    onTaskComplete,
  });

  useEffect(() => {
    if (selectedModelSessionIdRef.current === selectedSessionId) {
      return;
    }

    selectedModelSessionIdRef.current = selectedSessionId;

    if (!selectedSessionId) {
      pendingSessionModelHydrationRef.current = null;
      setSelectedModelState(null);
      return;
    }

    const sessionModel = getSelectedSessionModel(selectedMessages, availableModels);
    setSelectedModelState(sessionModel);
    pendingSessionModelHydrationRef.current = sessionModel ? null : selectedSessionId;
  }, [availableModels, selectedMessages, selectedSessionId]);

  useEffect(() => {
    if (selectedSessionId) {
      return;
    }
    if (availableModels.length === 0 || selectedModel) {
      return;
    }

    if (pendingInitialGenerationDefaultModelRef.current) {
      pendingInitialGenerationDefaultModelRef.current = false;
      setSelectedModelState(availableModels[0] ?? null);
      return;
    }

    setSelectedModelState(
      getStoredSelectedModelPreference(availableModels) ?? availableModels[0],
    );
  }, [availableModels, selectedModel, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }
    if (pendingSessionModelHydrationRef.current !== selectedSessionId) {
      return;
    }

    const sessionModel = getSelectedSessionModel(selectedMessages, availableModels);
    if (!sessionModel) {
      return;
    }

    pendingSessionModelHydrationRef.current = null;
    setSelectedModelState(sessionModel);
  }, [availableModels, selectedMessages, selectedSessionId]);

  const startInitialGenerationMutation =
    trpc.agent.startInitialGeneration.useMutation();

  const queuedFollowups = selectedSessionId
    ? queuedFollowupsBySessionId[selectedSessionId] ?? []
    : [];
  const queuedFollowupSendingId = selectedSessionId
    ? queuedFollowupSendingBySessionId[selectedSessionId] ?? null
    : null;
  const hasBlockingRequest = Boolean(
    activeQuestionRequest || activePermissionRequest,
  );
  const hasBusySessionTarget =
    Boolean(selectedSessionId) && (isThinking || runTaskPending);
  const showSteerButton =
    followupBehavior === "queue" &&
    hasBusySessionTarget &&
    !hasBlockingRequest &&
    !isUsageBlocked;

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
      const hasSessionTarget = Boolean(targetSessionId);
      const busySession = hasSessionTarget && (isThinking || runTaskPending);

      if (hasBlockingRequest || (!hasSessionTarget && runTaskPending)) {
        options?.onCompleted?.(false);
        options?.onSettled?.();
        return;
      }

      if (
        targetSessionId &&
        busySession &&
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
      hasBlockingRequest,
      followupBehavior,
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

    const { message: pendingMessage, startNewSession } = pending;
    const targetSessionId = startNewSession ? null : selectedSessionId;

    clearPending();

    if (startNewSession) {
      setSelectedSessionId(null);
      clearSessionError();
    }

    setInput("");
    submitPreparedTask(pendingMessage, targetSessionId);
  }, [
    previewContext?.pendingChatMessage,
    previewContext?.clearPendingChatMessage,
    hasBlockingRequest,
    clearSessionError,
    isPreparingSend,
    isThinking,
    runTaskPending,
    selectedSessionId,
    setSelectedSessionId,
    submitPreparedTask,
  ]);

  const startInitialGeneration = useCallback(() => {
    if (initialGenerationStarting) return;

    if (initialGenerationRequested && (requestedInitialSessionId || selectedSessionId)) {
      return;
    }

    previewContext?.clearPendingChatMessage?.();
    previewContext?.setChatOpen(true);
    setInitialGenerationFailed(null);

    void (async () => {
      try {
        const model = resolveInitialGenerationModel();
        setInitialGenerationStarting(true);
        clearSessionError();

        const result = await startInitialGenerationMutation.mutateAsync({
          projectSlug,
          version,
          model,
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
    initialGenerationRequested,
    previewContext,
    projectSlug,
    refetchSessions,
    resolveInitialGenerationModel,
    requestedInitialSessionId,
    setSelectedSessionId,
    selectedSessionId,
    startInitialGenerationMutation,
    version,
  ]);

  const retryInitialGeneration = useCallback(() => {
    autoInitialGenerationAttemptedRef.current = true;
    startInitialGeneration();
  }, [startInitialGeneration]);

  useEffect(() => {
    autoInitialGenerationAttemptedRef.current = false;
    setInitialGenerationFailed(null);
  }, [
    initialGenerationRequested,
    projectSlug,
    requestedInitialSessionId,
    version,
  ]);

  useEffect(() => {
    if (!initialGenerationRequested) return;
    if (requestedInitialSessionId) return;
    if (selectedSessionId) return;
    if (sessionsLoading || isSessionHydrating) return;
    if (initialGenerationStarting || initialGenerationFailed) return;
    if (runTaskPending || hasBlockingRequest) return;
    if (autoInitialGenerationAttemptedRef.current) return;

    autoInitialGenerationAttemptedRef.current = true;
    startInitialGeneration();
  }, [
    hasBlockingRequest,
    initialGenerationFailed,
    initialGenerationRequested,
    initialGenerationStarting,
    isSessionHydrating,
    requestedInitialSessionId,
    runTaskPending,
    selectedSessionId,
    sessionsLoading,
    startInitialGeneration,
  ]);

  useEffect(() => {
    if (selectedSessionId) {
      setInitialGenerationFailed(null);
    }
  }, [selectedSessionId]);

  const submitCurrentInput = useCallback(
    async (options?: { forceSend?: boolean }) => {
      const hasSessionTarget = Boolean(selectedSessionId);
      if (
        (!input.trim() &&
          !attachedElement &&
          attachedImages.length === 0 &&
          attachedFiles.length === 0) ||
        hasBlockingRequest ||
        isPreparingSendRef.current ||
        (!hasSessionTarget && runTaskPending)
      ) {
        return;
      }

      isPreparingSendRef.current = true;
      setIsPreparingSend(true);

      try {
        const task = await buildTaskWithAttachments(input);

        setInput("");
        setAttachedElement(null);
        clearSessionError();

        submitPreparedTask(task, selectedSessionId, {
          forceSend: options?.forceSend,
        });
      } finally {
        isPreparingSendRef.current = false;
        setIsPreparingSend(false);
      }
    },
    [
      hasBlockingRequest,
      attachedElement,
      attachedFiles.length,
      attachedImages.length,
      buildTaskWithAttachments,
      clearSessionError,
      input,
      runTaskPending,
      selectedSessionId,
      submitPreparedTask,
    ],
  );

  const handleSend = useCallback(() => {
    void submitCurrentInput();
  }, [submitCurrentInput]);

  const handleSteerSend = useCallback(() => {
    void submitCurrentInput({ forceSend: true });
  }, [submitCurrentInput]);

  const handleContinueSession = useCallback(() => {
    if (
      !selectedSessionId ||
      hasBlockingRequest ||
      isThinking ||
      runTaskPending ||
      isPreparingSend ||
      isUsageBlocked
    ) {
      return;
    }

    sendTask("continue", selectedSessionId);
  }, [
    selectedSessionId,
    hasBlockingRequest,
    isThinking,
    isPreparingSend,
    runTaskPending,
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

  const handleRespondPermission = useCallback(
    async (
      requestId: string,
      sessionId: string,
      response: "once" | "always" | "reject",
    ) => {
      await respondPermission(requestId, sessionId, response);
    },
    [respondPermission],
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
      hasBlockingRequest ||
      isThinking ||
      runTaskPending ||
      isPreparingSend ||
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
    hasBlockingRequest,
    isPreparingSend,
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
    showSteerButton,
    queuedFollowups,
    queuedFollowupSendingId,
    selectorMode,
    setSelectorMode,
    selectorModeAvailable: !!setSelectorMode,
    isReverted,
    isLoading:
      initialGenerationStarting ||
      isPreparingSend ||
      (!selectedSessionId && runTaskPending),
    activeQuestionRequest,
    activePermissionRequest,
    sessionDebugState,
    sessionError,
    clearSessionError,
    usageLimitStatus: usageLimitStatus ?? null,
    isUsageBlocked,
    softContextLimitTokens,
    availableModels,
    selectedModel,
    setSelectedModel,
    initialGenerationRequested,
    initialGenerationStarting,
    initialGenerationFailed,
    retryInitialGeneration,
    handleSend,
    handleSteerSend,
    handleReplyQuestion,
    handleRejectQuestion,
    handleRespondPermission,
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
              variant={confirmDialog.destructive ? "destructive" : undefined}
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
