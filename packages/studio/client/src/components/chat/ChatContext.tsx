import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { POLLING_INFREQUENT } from "@/app/config/polling";
import { useOptionalPreview } from "../preview/PreviewContext";
import type {
  ChatContextValue,
  ModelTier,
  SessionDebugState,
} from "./chatTypes";
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

  const setSelectedModel = useCallback((model: ModelTier | null) => {
    setSelectedModelState(model);
    if (model) {
      localStorage.setItem(
        "vivd-selected-model",
        JSON.stringify({ provider: model.provider, modelId: model.modelId }),
      );
    }
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
    sendTask,
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

    const { message: pendingMessage, startNewSession } = pending;
    const targetSessionId = startNewSession ? null : selectedSessionId;

    if (startNewSession) {
      setSelectedSessionId(null);
      clearSessionError();
    }

    setInput("");
    sendTask(pendingMessage, targetSessionId);
  }, [
    previewContext?.pendingChatMessage,
    previewContext?.clearPendingChatMessage,
    selectedSessionId,
    clearSessionError,
    sendTask,
    setSelectedSessionId,
  ]);

  const handleSend = async () => {
    if (
      (!input.trim() &&
        !attachedElement &&
        attachedImages.length === 0 &&
        attachedFiles.length === 0) ||
      isThinking ||
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

    sendTask(task, selectedSessionId, {
      onSettled: () => setIsSending(false),
    });
  };

  const handleContinueSession = useCallback(() => {
    if (
      !selectedSessionId ||
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
    isThinking,
    runTaskPending,
    isSending,
    isUsageBlocked,
    sendTask,
  ]);

  const handleNewSession = useCallback(() => {
    setSelectedSessionId(null);
    setInput("");
    clearSessionError();
  }, [clearSessionError, setSelectedSessionId]);

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
    stopGeneration();
  }, [stopGeneration]);

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
    selectorMode,
    setSelectorMode,
    selectorModeAvailable: !!setSelectorMode,
    isReverted,
    isLoading: runTaskPending || isSending,
    sessionDebugState,
    sessionError,
    clearSessionError,
    usageLimitStatus: usageLimitStatus ?? null,
    isUsageBlocked,
    availableModels,
    selectedModel,
    setSelectedModel,
    handleSend,
    handleContinueSession,
    handleNewSession,
    handleDeleteSession,
    handleRevert,
    handleUnrevert,
    handleStopGeneration,
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
