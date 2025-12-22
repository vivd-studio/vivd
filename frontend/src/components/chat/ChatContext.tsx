import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { usePreview } from "../preview/PreviewContext";
import { formatMessageWithSelector } from "./SelectedElementPill";

// Types
export interface Message {
  id?: string;
  role: "user" | "agent";
  content: string;
  parts?: any[];
}

interface Session {
  id: string;
  revert?: { messageID: string };
}

interface AttachedElement {
  selector: string;
  description: string;
}

// Debug state for session monitoring
export interface SessionDebugState {
  selectedSessionId: string | null;
  isStreaming: boolean;
  isWaiting: boolean;
  isThinking: boolean;
  streamingPartsCount: number;
  messagesCount: number;
  sseConnected: boolean;
  lastEventTime: string | null;
  lastEventType: string | null;
  sessionError: SessionError | null;
  sessionStatus: string | null; // "idle" | "busy" | "retry" from backend
}

export interface SessionError {
  type: string;
  message: string;
  attempt?: number;
  nextRetryAt?: number;
}

interface ChatContextValue {
  // Project info
  projectSlug: string;
  version?: number;

  // Session state
  sessions: Session[];
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;

  // Messages
  messages: Message[];

  // Streaming state
  isStreaming: boolean;
  isWaiting: boolean;
  isThinking: boolean;
  streamingParts: any[];

  // Input state
  input: string;
  setInput: (value: string) => void;
  attachedElement: AttachedElement | null;
  setAttachedElement: (element: AttachedElement | null) => void;

  // Element selector
  selectorMode: boolean;
  setSelectorMode: ((mode: boolean) => void) | undefined;
  selectorModeAvailable: boolean;

  // Derived state
  isReverted: boolean;
  isLoading: boolean;

  // Debug
  sessionDebugState: SessionDebugState;

  // Error state
  sessionError: SessionError | null;
  clearSessionError: () => void;

  // Actions
  handleSend: () => void;
  handleNewSession: () => void;
  handleDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
  handleRevert: (messageId: string) => void;
  handleUnrevert: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
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
  // Access PreviewContext for element selection (may not be available outside preview page)
  let previewContext: ReturnType<typeof usePreview> | null = null;
  try {
    previewContext = usePreview();
  } catch {
    // Not in a preview context, element selection won't be available
  }

  const selectorMode = previewContext?.selectorMode ?? false;
  const setSelectorMode = previewContext?.setSelectorMode;
  const selectedElement = previewContext?.selectedElement ?? null;
  const clearSelectedElement = previewContext?.clearSelectedElement;

  // Local state for attached element (shown as pill)
  const [attachedElement, setAttachedElement] =
    useState<AttachedElement | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  // Ref to access current messages in effects without adding to dependency array
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const pendingSessionIdRef = useRef<string | null>(null);

  // Derive isReverted from session data instead of local state
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const isReverted = Boolean(selectedSession?.revert);

  // Real-time streaming state from SSE subscription
  const [isStreaming, setIsStreaming] = useState(false);
  // Unified streaming parts state to support interleaved thoughts/tools/text
  const [streamingParts, setStreamingParts] = useState<any[]>([]);

  // Track if we're waiting for agent response
  const isWaitingForAgent = useRef(false);
  const [isWaiting, setIsWaiting] = useState(false);

  // Debug tracking for SSE connection status
  const [sseConnected, setSseConnected] = useState(false);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);
  const [lastEventType, setLastEventType] = useState<string | null>(null);

  // Session error state (for quota limits, API errors, etc.)
  const [sessionError, setSessionError] = useState<SessionError | null>(null);
  const clearSessionError = () => setSessionError(null);

  // Poll for sessions to keep the list and status updated
  const { data: sessionsData, refetch: refetchSessions } =
    trpc.agent.listSessions.useQuery(
      { projectSlug, version },
      {
        refetchOnMount: true,
        // Poll every 2 seconds when waiting or streaming to keep session status in sync
        refetchInterval: isWaiting || isStreaming ? 2000 : false,
      }
    );

  // Poll for session statuses - this is the source of truth for whether a session is active
  const { data: sessionStatuses } = trpc.agent.getSessionsStatus.useQuery(
    { projectSlug, version },
    {
      // Poll more frequently when we think something is active
      refetchInterval: isWaiting || isStreaming ? 2000 : 10000,
    }
  );

  // Get current session's status from polled data
  const currentSessionStatus = selectedSessionId
    ? sessionStatuses?.[selectedSessionId]
    : undefined;

  useEffect(() => {
    setSelectedSessionId(null);
    setMessages([]);
    setIsStreaming(false);
    setStreamingParts([]);
  }, [projectSlug]);

  useEffect(() => {
    const isPendingSession = pendingSessionIdRef.current === selectedSessionId;

    setStreamingParts([]);
    setIsStreaming(false);
    setSessionError(null);
    setSseConnected(false);
    setLastEventTime(null);
    setLastEventType(null);

    if (isPendingSession) {
      pendingSessionIdRef.current = null;
      if (isWaitingForAgent.current) {
        setIsWaiting(true);
      }
      return;
    }

    setMessages([]);
    setIsWaiting(false);
    isWaitingForAgent.current = false;
  }, [selectedSessionId]);

  // Handle element selection - attach element and clear from context
  useEffect(() => {
    if (selectedElement && clearSelectedElement) {
      setAttachedElement({
        selector: selectedElement.selector,
        description: selectedElement.description,
      });
      clearSelectedElement();
    }
  }, [selectedElement, clearSelectedElement]);

  useEffect(() => {
    if (sessionsData) {
      // @ts-ignore
      setSessions(sessionsData);
    }
  }, [sessionsData]);

  // Poll for messages of the selected session
  const { data: sessionMessages, refetch: refetchMessages } =
    trpc.agent.getSessionContent.useQuery(
      {
        sessionId: selectedSessionId!,
      },
      {
        enabled: !!selectedSessionId,
        // Poll every 2 seconds when waiting/streaming as a recovery mechanism
        // in case SSE events are missed
        refetchInterval: isWaiting || isStreaming ? 2000 : false,
      }
    );

  // Sync local streaming state with the polled session status (source of truth)
  // This handles cases where SSE events were missed (reconnection, session switch, page refresh)
  useEffect(() => {
    if (!currentSessionStatus) return;

    if (currentSessionStatus.type === "idle") {
      // Session is definitely done - clear all streaming state if it was stuck
      if (isWaitingForAgent.current && !isStreaming) {
        if (!isWaiting) {
          setIsWaiting(true);
        }
        return;
      }

      if (isStreaming || isWaiting) {
        console.log(
          "[ChatContext] Session status is idle but was streaming/waiting - resetting state"
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
        console.log(
          "[ChatContext] Session status is busy but idle locally - marking waiting state"
        );
        setIsWaiting(true);
      }
    } else if (currentSessionStatus.type === "retry") {
      // Session is in retry state (quota error, etc.)
      console.log(
        "[ChatContext] Session status is retry:",
        currentSessionStatus
      );
      setSessionError({
        type: "retry",
        message: currentSessionStatus.message || "Session retrying",
        attempt: currentSessionStatus.attempt,
        nextRetryAt: currentSessionStatus.next,
      });
      setIsStreaming(false);
      setIsWaiting(false);
      isWaitingForAgent.current = false;
    }
  }, [currentSessionStatus, isStreaming, isWaiting, refetchMessages]);

  // SSE subscription for real-time events
  trpc.agent.sessionEvents.useSubscription(
    {
      sessionId: selectedSessionId ?? "",
    },
    {
      enabled: !!selectedSessionId,
      onStarted: () => {
        console.log("[ChatContext] SSE subscription started");
        setSseConnected(true);
      },
      onData: (trackedEvent) => {
        const event = trackedEvent.data;
        const innerData = event.data;

        // Track debug info
        setLastEventTime(new Date().toISOString());
        setLastEventType(innerData.kind);

        switch (innerData.kind) {
          case "thinking.started":
            // Clear any stale streaming parts from previous turns
            setStreamingParts([]);
            setIsStreaming(false);
            setIsWaiting(true);
            break;

          case "reasoning.delta":
            // Ensure we mark as streaming when receiving content
            setIsStreaming(true);
            setIsWaiting(false);
            if ("content" in innerData && "partId" in innerData) {
              const partId = innerData.partId;
              setStreamingParts((prev) => {
                const existingIndex = prev.findIndex((p) => p.id === partId);
                if (existingIndex !== -1) {
                  const newParts = [...prev];
                  newParts[existingIndex] = {
                    ...newParts[existingIndex],
                    text: newParts[existingIndex].text + innerData.content,
                  };
                  return newParts;
                } else {
                  return [
                    ...prev,
                    {
                      id: partId,
                      type: "reasoning",
                      text: innerData.content,
                    },
                  ];
                }
              });
            }
            break;

          case "message.delta":
            // Ensure we mark as streaming when receiving content
            setIsStreaming(true);
            setIsWaiting(false);
            if ("content" in innerData && "partId" in innerData) {
              const partId = innerData.partId;
              setStreamingParts((prev) => {
                const existingIndex = prev.findIndex((p) => p.id === partId);
                if (existingIndex !== -1) {
                  const newParts = [...prev];
                  newParts[existingIndex] = {
                    ...newParts[existingIndex],
                    text: newParts[existingIndex].text + innerData.content,
                  };
                  return newParts;
                } else {
                  return [
                    ...prev,
                    {
                      id: partId,
                      type: "text",
                      text: innerData.content,
                    },
                  ];
                }
              });
            }
            break;

          case "tool.started":
            if ("toolId" in innerData && "tool" in innerData) {
              setIsStreaming(true);
              setIsWaiting(false);
              const toolId = innerData.toolId as string;
              const tool = innerData.tool as string;
              const title =
                "title" in innerData ? (innerData.title as string) : undefined;

              setStreamingParts((prev) => [
                ...prev,
                {
                  id: toolId,
                  type: "tool",
                  tool,
                  title,
                  status: "running",
                },
              ]);
            }
            break;

          case "tool.completed":
            if ("toolId" in innerData) {
              const toolId = innerData.toolId as string;
              setStreamingParts((prev) =>
                prev.map((p) =>
                  p.id === toolId ? { ...p, status: "completed" } : p
                )
              );
            }
            break;

          case "tool.error":
            if ("toolId" in innerData) {
              const toolId = innerData.toolId as string;
              setStreamingParts((prev) =>
                prev.map((p) =>
                  p.id === toolId ? { ...p, status: "error" } : p
                )
              );
            }
            break;

          case "session.completed":
            setIsStreaming(false);
            setStreamingParts([]);
            isWaitingForAgent.current = false;
            setIsWaiting(false);
            setSessionError(null); // Clear any previous errors on success
            refetchMessages();
            onTaskComplete?.();
            break;

          case "session.error":
            // Handle session errors (quota exceeded, retry status, etc.)
            if ("errorType" in innerData && "message" in innerData) {
              setSessionError({
                type: innerData.errorType as string,
                message: innerData.message as string,
                attempt: (innerData as any).attempt,
                nextRetryAt: (innerData as any).nextRetryAt,
              });
              // Clear waiting states - we're in an error state now
              setIsWaiting(false);
              setIsStreaming(false);
            }
            break;
        }
      },
      onError: (err) => {
        console.error("[SessionEvents] Subscription error:", err);
        setSseConnected(false);
        setIsStreaming(false);
        setIsWaiting(false);
        // Refetch messages on SSE error to ensure state is synchronized
        refetchMessages();
        refetchSessions();
      },
    }
  );

  useEffect(() => {
    if (sessionMessages && selectedSessionId) {
      const mappedMessages: Message[] = sessionMessages.map((msg: any) => {
        const role = msg.info?.role === "assistant" ? "agent" : "user";
        const textContent =
          msg.parts
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n") || "";

        return {
          id: msg.info?.id,
          role,
          content: textContent,
          parts: msg.parts,
        };
      });
      setMessages(mappedMessages);

      // Recovery: If we're waiting/streaming but the fetched messages include a
      // NEWER agent response than what's in our current messages, we likely missed
      // the SSE event. Only apply recovery if we sent a user message that the server
      // has now responded to.
      if ((isWaiting || isStreaming) && mappedMessages.length > 0) {
        const lastFetchedMessage = mappedMessages[mappedMessages.length - 1];
        const currentMessages = messagesRef.current;
        const lastLocalMessage = currentMessages[currentMessages.length - 1];

        // Only recover if:
        // 1. The fetched messages end with an agent message with content
        // 2. AND our local messages also end with a user message that was already sent
        //    (meaning the server has responded but we missed the SSE)
        // 3. OR fetched message count is higher (new messages arrived)
        const serverHasAgentResponse =
          lastFetchedMessage.role === "agent" && lastFetchedMessage.content;
        const localEndsWithUser = lastLocalMessage?.role === "user";
        const fetchedMessageCountHigher =
          mappedMessages.length > currentMessages.length;

        if (
          serverHasAgentResponse &&
          (localEndsWithUser || fetchedMessageCountHigher)
        ) {
          console.log(
            "[ChatContext] Recovery: Task completed but state was stuck. Resetting."
          );
          setIsStreaming(false);
          setIsWaiting(false);
          isWaitingForAgent.current = false;
          setStreamingParts([]);
          onTaskComplete?.();
        }
      }
    }
  }, [sessionMessages, selectedSessionId]);

  // Derive thinking state from streaming status or message heuristic
  const isThinking = isStreaming || isWaiting;

  const runTaskMutation = trpc.agent.runTask.useMutation({
    onSuccess: (data) => {
      if (data.sessionId) {
        if (data.sessionId !== selectedSessionId) {
          pendingSessionIdRef.current = data.sessionId;
          setSelectedSessionId(data.sessionId);
        }
        refetchSessions();
        isWaitingForAgent.current = true;
      }
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Error: ${error.message}` },
      ]);
      isWaitingForAgent.current = false;
      setIsWaiting(false);
    },
  });

  const deleteSessionMutation = trpc.agent.deleteSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      if (sessions.length > 0) {
        if (selectedSessionId) {
          setSelectedSessionId(null);
          setMessages([]);
        }
      }
    },
  });

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string
  ) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this session?")) {
      await deleteSessionMutation.mutateAsync({
        sessionId,
        projectSlug,
        version,
      });
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setMessages([]);
      }
    }
  };

  const revertMutation = trpc.agent.revertToMessage.useMutation({
    onSuccess: () => {
      refetchSessions();
      onTaskComplete?.();
    },
  });

  const unrevertMutation = trpc.agent.unrevertSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      onTaskComplete?.();
    },
  });

  const handleRevert = async (messageId: string) => {
    if (!selectedSessionId) return;
    if (
      confirm("Revert changes from this task? This will undo file changes.")
    ) {
      await revertMutation.mutateAsync({
        sessionId: selectedSessionId,
        messageId,
        projectSlug,
        version,
      });
    }
  };

  const handleUnrevert = async () => {
    if (!selectedSessionId) return;
    await unrevertMutation.mutateAsync({
      sessionId: selectedSessionId,
      projectSlug,
      version,
    });
  };

  const handleSend = () => {
    if ((!input.trim() && !attachedElement) || runTaskMutation.isPending)
      return;

    let task = input.trim() || "I want to change this element";
    if (attachedElement) {
      task = formatMessageWithSelector(task, attachedElement.selector);
    }

    setInput("");
    setAttachedElement(null);

    isWaitingForAgent.current = true;
    setIsStreaming(false);
    setIsWaiting(true);

    setStreamingParts([]);

    console.log("[Vivd] Sending prompt:", task);

    if (selectedSessionId) {
      setMessages((prev) => [...prev, { role: "user", content: task }]);
      runTaskMutation.mutate({
        projectSlug,
        task,
        sessionId: selectedSessionId,
        version,
      });
    } else {
      setMessages((prev) => [...prev, { role: "user", content: task }]);
      runTaskMutation.mutate({ projectSlug, task, version });
    }
  };

  const handleNewSession = () => {
    pendingSessionIdRef.current = null;
    setSelectedSessionId(null);
    setMessages([]);
    // Clear streaming state to prevent previous session data from appearing
    setIsStreaming(false);
    setIsWaiting(false);
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
    sessionError,
    sessionStatus: currentSessionStatus?.type ?? null,
  };

  const value: ChatContextValue = {
    projectSlug,
    version,
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    messages,
    isStreaming,
    isWaiting,
    isThinking,
    streamingParts,
    input,
    setInput,
    attachedElement,
    setAttachedElement,
    selectorMode,
    setSelectorMode,
    selectorModeAvailable: !!setSelectorMode,
    isReverted,
    isLoading: runTaskMutation.isPending,
    sessionDebugState,
    sessionError,
    clearSessionError,
    handleSend,
    handleNewSession,
    handleDeleteSession,
    handleRevert,
    handleUnrevert,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
