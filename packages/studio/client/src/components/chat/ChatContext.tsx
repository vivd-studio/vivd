import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import {
  POLLING_INFREQUENT,
} from "@/app/config/polling";
import { useOptionalPreview } from "../preview/PreviewContext";
import {
  markEventAsProcessed,
  type EventDedupState,
} from "./chatStreamUtils";
import type {
  ChatContextValue,
  Message,
  ModelTier,
  SessionDebugState,
  SessionError,
  UsageData,
} from "./chatTypes";
import {
  calculateUsageFromSessionMessages,
  mapSessionMessagesToChatMessages,
  shouldRecoverFromMissedStreamEvents,
} from "./chatMessageUtils";
import { useChatAttachments } from "./useChatAttachments";
import { useChatSessions } from "./useChatSessions";
import { useChatActions } from "./useChatActions";
import { sanitizeSessionError } from "./chatErrorPolicy";
import {
  handleSessionEvent,
  handleSessionStreamError,
} from "./chatEventHandlers";
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

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

/**
 * Returns the ChatContext value if inside a ChatProvider, or null otherwise.
 * Use this when a component may or may not be rendered within a ChatProvider.
 */
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
  const debugEnabled = import.meta.env.VITE_DEBUG_CHAT === "true";
  const debugLog = (...args: unknown[]) => {
    if (debugEnabled) {
      console.log(...args);
    }
  };

  // Access PreviewContext for element selection (may not be available outside preview page)
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

  const [messages, setMessages] = useState<Message[]>([]);
  // Ref to access current messages in effects without adding to dependency array
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  // Track if we're in the process of sending (includes image upload phase)
  const [isSending, setIsSending] = useState(false);
  const pendingSessionIdRef = useRef<string | null>(null);
  const continueClickLockRef = useRef(false);
  const autoSelectLockedRef = useRef(false);
  const hasAutoSelectedRunningSessionRef = useRef(false);

  // Real-time streaming state from SSE subscription
  const [isStreaming, setIsStreaming] = useState(false);
  // Unified streaming parts state to support interleaved thoughts/tools/text
  const [streamingParts, setStreamingParts] = useState<any[]>([]);

  // Track if we're waiting for agent response
  const isWaitingForAgent = useRef(false);
  const [isWaiting, setIsWaiting] = useState(false);

  const {
    sessions,
    sessionsLoading,
    selectedSessionId,
    setSelectedSessionId,
    selectSession,
    isSessionHydrating,
    setIsSessionHydrating,
    sessionMessages,
    sessionMessagesIsError,
    sessionMessagesError,
    refetchMessages,
    refetchSessions,
    currentSessionStatus,
    shouldSubscribeToSessionEvents,
  } = useChatSessions({
    projectSlug,
    version,
    isActive: isWaiting || isStreaming,
    autoSelectLockedRef,
    hasAutoSelectedRunningSessionRef,
  });

  // Derive isReverted from session data instead of local state
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const isReverted = Boolean(selectedSession?.revert);

  // Debug tracking for SSE connection status
  const [sseConnected, setSseConnected] = useState(false);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);
  const [lastEventType, setLastEventType] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);

  // Track last processed event ID per session for resumable SSE streams
  // This prevents replay of old events (like session.completed) on reconnect
  const lastEventIdBySession = useRef<Map<string, string>>(new Map());
  const processedEventIdsBySession = useRef<Map<string, EventDedupState>>(
    new Map(),
  );
  const EVENT_ID_DEDUPE_WINDOW = 500;

  // Session error state (for quota limits, API errors, etc.)
  const [sessionError, setSessionError] = useState<SessionError | null>(null);
  const clearSessionError = () => setSessionError(null);

  // Poll usage limits - refetch infrequently or manually after session completes
  const { data: usageLimitStatus, refetch: refetchUsageStatus } =
    trpc.usage.status.useQuery(undefined, {
      refetchInterval: POLLING_INFREQUENT,
      staleTime: 10000,
    });

  // Derive if usage is blocked
  const isUsageBlocked = usageLimitStatus?.blocked ?? false;

  // Fetch available models for model selector
  const { data: availableModelsData } = trpc.agent.getAvailableModels.useQuery(
    undefined,
    {
      staleTime: 60000, // Cache for 1 minute
    },
  );
  const availableModels = (availableModelsData ?? []) as ModelTier[];

  // Selected model state - load from localStorage or auto-select first model
  const [selectedModel, setSelectedModelState] = useState<ModelTier | null>(
    null,
  );

  // Wrapper to save to localStorage when model changes
  const setSelectedModel = useCallback((model: ModelTier | null) => {
    setSelectedModelState(model);
    if (model) {
      localStorage.setItem(
        "vivd-selected-model",
        JSON.stringify({ provider: model.provider, modelId: model.modelId }),
      );
    }
  }, []);

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
    [projectSlug, version, selectedModel],
  );

  // Load saved model preference or auto-select first model when models become available
  useEffect(() => {
    if (availableModels.length === 0) return;
    if (selectedModel) return;

    // Try to load saved preference from localStorage
    const savedModel = localStorage.getItem("vivd-selected-model");
    if (savedModel) {
      try {
        const { provider, modelId } = JSON.parse(savedModel);
        const matchingModel = availableModels.find(
          (m) => m.provider === provider && m.modelId === modelId,
        );
        if (matchingModel) {
          setSelectedModelState(matchingModel);
          return;
        }
      } catch {
        // Invalid saved value, fall through to default
      }
    }

    // Fall back to first available model
    setSelectedModelState(availableModels[0]);
  }, [availableModels, selectedModel]);

  const {
    runTaskMutation,
    sendTask,
    confirmDialog,
    resolveConfirm,
    cancelConfirmIfPending,
    handleDeleteSession,
    handleRevert,
    handleUnrevert,
    handleStopGeneration,
  } = useChatActions({
    projectSlug,
    version,
    onTaskComplete,
    selectedSessionId,
    setSelectedSessionId: selectSession,
    setPendingSessionId: (sessionId) => {
      pendingSessionIdRef.current = sessionId;
    },
    refetchMessages,
    refetchSessions,
    isWaitingForAgent,
    buildRunTaskPayload,
    setMessages,
    setIsStreaming,
    setIsWaiting,
    setStreamingParts,
    setSessionError,
  });

  useEffect(() => {
    setSelectedSessionId(null);
    setMessages([]);
    setIsStreaming(false);
    setStreamingParts([]);
    setIsSessionHydrating(false);
    lastEventIdBySession.current.clear();
    processedEventIdsBySession.current.clear();
    autoSelectLockedRef.current = false;
    hasAutoSelectedRunningSessionRef.current = false;
  }, [projectSlug]);

  useEffect(() => {
    const isPendingSession = pendingSessionIdRef.current === selectedSessionId;
    continueClickLockRef.current = false;

    setStreamingParts([]);
    setIsStreaming(false);
    setSessionError(null);
    setSseConnected(false);
    setLastEventTime(null);
    setLastEventType(null);
    setUsage(null);

    if (isPendingSession) {
      pendingSessionIdRef.current = null;
      setIsSessionHydrating(false);
      if (isWaitingForAgent.current) {
        setIsWaiting(true);
      }
      return;
    }

    setMessages([]);
    setIsWaiting(false);
    isWaitingForAgent.current = false;
    setIsSessionHydrating(Boolean(selectedSessionId));
  }, [selectedSessionId]);

  // Handle element selection - attach element and clear from context
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
  }, [selectedElement, clearSelectedElement]);

  // Handle pending chat messages from PreviewContext (e.g., from "Fix This" button in PublishDialog)
  useEffect(() => {
    const pending = previewContext?.pendingChatMessage;
    const clearPending = previewContext?.clearPendingChatMessage;

    if (pending && clearPending) {
      // Clear immediately to prevent re-triggering
      clearPending();

      const { message: pendingMessage, startNewSession } = pending;
      const targetSessionId = startNewSession ? null : selectedSessionId;

      // If startNewSession is requested, clear the current session first
      if (startNewSession) {
        autoSelectLockedRef.current = true;
        pendingSessionIdRef.current = null;
        setSelectedSessionId(null);
        setMessages([]);
        setIsStreaming(false);
        setIsWaiting(false);
        setStreamingParts([]);
        setSessionError(null);
      }

      setInput("");
      debugLog("[Vivd] Sending pending prompt:", pendingMessage);
      sendTask(pendingMessage, targetSessionId);
    }
  }, [
    previewContext?.pendingChatMessage,
    previewContext?.clearPendingChatMessage,
    selectedSessionId,
    sendTask,
  ]);

  useEffect(() => {
    if (!selectedSessionId) return;
    if (!sessionMessagesIsError) return;

    setIsSessionHydrating(false);
    setSessionError(
      sanitizeSessionError({
        type: "load",
        message:
          (sessionMessagesError as any)?.message || "Failed to load session",
      }),
    );
  }, [selectedSessionId, sessionMessagesIsError, sessionMessagesError]);

  // Sync local streaming state with the polled session status (source of truth)
  // This handles cases where SSE events were missed (reconnection, session switch, page refresh)
  useEffect(() => {
    if (!currentSessionStatus) return;

    if ((currentSessionStatus as any).type === "done") {
      if (isStreaming || isWaiting || isWaitingForAgent.current) {
        debugLog(
          "[ChatContext] Session status is done - clearing waiting/streaming state",
        );
        setIsStreaming(false);
        setIsWaiting(false);
        isWaitingForAgent.current = false;
        setStreamingParts([]);
        refetchMessages();
      }
    } else if (currentSessionStatus.type === "idle") {
      // If we just sent a message (isWaitingForAgent.current is true), don't reset
      // The session status may still be "idle" from the previous task - wait for it to update
      if (isWaitingForAgent.current) {
        if (!isWaiting) {
          setIsWaiting(true);
        }
        return;
      }

      // Only reset if we're NOT actively waiting for a response
      if (isStreaming || isWaiting) {
        debugLog(
          "[ChatContext] Session status is idle but was streaming/waiting - resetting state",
        );
        setIsStreaming(false);
        setIsWaiting(false);
        isWaitingForAgent.current = false;
        setStreamingParts([]);
        refetchMessages();
      }
    } else if (currentSessionStatus.type === "busy") {
      // Session is active - ensure we're in streaming state
      if (!isStreaming && !isWaiting) {
        debugLog(
          "[ChatContext] Session status is busy but idle locally - marking waiting state",
        );
        setIsWaiting(true);
      }
    } else if (currentSessionStatus.type === "retry") {
      // Session is in retry state (quota error, etc.)
      debugLog("[ChatContext] Session status is retry:", currentSessionStatus);
      setSessionError(
        sanitizeSessionError({
          type: "retry",
          message: currentSessionStatus.message || "Session retrying",
          attempt: currentSessionStatus.attempt,
          nextRetryAt: currentSessionStatus.next,
        }),
      );
      setIsStreaming(false);
      setIsWaiting(false);
      isWaitingForAgent.current = false;
    } else if ((currentSessionStatus as any).type === "error") {
      debugLog("[ChatContext] Session status is error:", currentSessionStatus);
      setSessionError(
        sanitizeSessionError({
          type: "task",
          message: (currentSessionStatus as any).message || "Session failed",
          attempt: (currentSessionStatus as any).attempt,
          nextRetryAt: (currentSessionStatus as any).next,
        }),
      );
      setIsStreaming(false);
      setIsWaiting(false);
      isWaitingForAgent.current = false;
    }
  }, [currentSessionStatus, isStreaming, isWaiting, refetchMessages]);

  // SSE subscription for real-time events
  trpc.agent.sessionEvents.useSubscription(
    {
      sessionId: selectedSessionId ?? "",
      // Pass last processed event ID to resume from where we left off on reconnect
      // This prevents replay of old events (like session.completed) causing UI glitches
      lastEventId: selectedSessionId
        ? lastEventIdBySession.current.get(selectedSessionId)
        : undefined,
    },
    {
      enabled: shouldSubscribeToSessionEvents,
      onStarted: () => {
        debugLog("[ChatContext] SSE subscription started");
        setSseConnected(true);
      },
      onData: (trackedEvent) => {
        // Track and dedupe event IDs to avoid duplicate UI rendering on replay.
        if (selectedSessionId && trackedEvent.id) {
          const isNewEvent = markEventAsProcessed(
            processedEventIdsBySession.current,
            selectedSessionId,
            trackedEvent.id,
            EVENT_ID_DEDUPE_WINDOW,
          );
          if (!isNewEvent) {
            return;
          }

          // Keep pointer for resumable streams.
          lastEventIdBySession.current.set(selectedSessionId, trackedEvent.id);
        }

        const event = trackedEvent.data;
        const innerData = event.data as { kind: string; [key: string]: unknown };

        // Track debug info
        setLastEventTime(new Date().toISOString());
        setLastEventType(innerData.kind);

        handleSessionEvent({
          eventData: innerData,
          setStreamingParts,
          setIsStreaming,
          setIsWaiting,
          isWaitingForAgent,
          setSessionError,
          refetchMessages,
          refetchUsageStatus,
          setUsage,
          onTaskComplete,
        });
      },
      onError: (err) => {
        console.error("[SessionEvents] Subscription error:", err);
        handleSessionStreamError({
          error: err,
          setSseConnected,
          setIsStreaming,
          setIsWaiting,
          isWaitingForAgent,
          setSessionError,
          refetchMessages,
          refetchSessions,
        });
      },
    },
  );

  useEffect(() => {
    if (sessionMessages && selectedSessionId) {
      setIsSessionHydrating(false);
      const mappedMessages = mapSessionMessagesToChatMessages(sessionMessages);
      setMessages(mappedMessages);

      const calculatedUsage = calculateUsageFromSessionMessages(sessionMessages);
      if (calculatedUsage) {
        setUsage(calculatedUsage);
      }

      // Recovery: If we're waiting/streaming but the fetched messages include a
      // NEWER agent response than what's in our current messages, we likely missed
      // the SSE event. Only apply recovery if we sent a user message that the server
      // has now responded to.
      if (
        (isWaiting || isStreaming) &&
        shouldRecoverFromMissedStreamEvents(mappedMessages, messagesRef.current)
      ) {
        debugLog(
          "[ChatContext] Recovery: Task completed but state was stuck. Resetting.",
        );
        setIsStreaming(false);
        setIsWaiting(false);
        isWaitingForAgent.current = false;
        setStreamingParts([]);
        onTaskComplete?.();
      }
    }
  }, [sessionMessages, selectedSessionId]);

  // Derive thinking state from streaming status or message heuristic
  const isThinking = isStreaming || isWaiting;

  const handleSend = async () => {
    if (
      (!input.trim() &&
        !attachedElement &&
        attachedImages.length === 0 &&
        attachedFiles.length === 0) ||
      isStreaming ||
      runTaskMutation.isPending ||
      isSending
    )
      return;

    // Set sending state immediately to prevent duplicate submissions
    setIsSending(true);

    const task = await buildTaskWithAttachments(input);

    setInput("");
    setAttachedElement(null);

    debugLog("[Vivd] Sending prompt:", task);
    sendTask(task, selectedSessionId, {
      onSettled: () => setIsSending(false),
    });
  };

  const handleContinueSession = useCallback(() => {
    if (
      !selectedSessionId ||
      continueClickLockRef.current ||
      isStreaming ||
      runTaskMutation.isPending ||
      isSending ||
      isUsageBlocked
    ) {
      return;
    }

    continueClickLockRef.current = true;
    sendTask("continue", selectedSessionId, {
      onSettled: () => {
        continueClickLockRef.current = false;
      },
    });
  }, [
    selectedSessionId,
    isStreaming,
    runTaskMutation.isPending,
    isSending,
    isUsageBlocked,
    sendTask,
  ]);

  const handleNewSession = () => {
    autoSelectLockedRef.current = true;
    pendingSessionIdRef.current = null;
    setSelectedSessionId(null);
    setMessages([]);
    // Clear streaming state to prevent previous session data from appearing
    setIsStreaming(false);
    setIsWaiting(false);
    isWaitingForAgent.current = false;
    setStreamingParts([]);
    // Clear any error from previous session
    setSessionError(null);
  };

  // Build debug state object
  const sessionDebugState: SessionDebugState = {
    selectedSessionId,
    isStreaming,
    isWaiting,
    isThinking,
    streamingPartsCount: streamingParts.length,
    messagesCount: messages.length,
    sseConnected,
    lastEventTime,
    lastEventType,
    lastEventId: selectedSessionId
      ? (lastEventIdBySession.current.get(selectedSessionId) ?? null)
      : null,
    sessionError,
    sessionStatus: currentSessionStatus?.type ?? null,
    usage,
  };

  const value: ChatContextValue = {
    projectSlug,
    version,
    sessions,
    sessionsLoading,
    selectedSessionId,
    setSelectedSessionId: selectSession,
    isSessionHydrating,
    messages,
    isStreaming,
    isWaiting,
    isThinking,
    streamingParts,
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
    isLoading: runTaskMutation.isPending || isSending,
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
