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
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

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

  // Tracking for inactivity timeout (2 minutes)
  const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
  const lastEventTimeRef = useRef<number>(Date.now());
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset inactivity timer on each event
  const resetInactivityTimer = () => {
    lastEventTimeRef.current = Date.now();
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    if (isStreaming || isWaiting) {
      inactivityTimerRef.current = setTimeout(() => {
        console.warn(
          `[ChatContext] No events received for ${
            INACTIVITY_TIMEOUT_MS / 1000
          }s while waiting/streaming. Last event at: ${new Date(
            lastEventTimeRef.current
          ).toISOString()}`
        );
        console.warn("[ChatContext] Auto-recovering from stuck state...");
        // Auto-recover: reset streaming state and refetch messages
        setIsStreaming(false);
        setIsWaiting(false);
        isWaitingForAgent.current = false;
        setStreamingParts([]);
        refetchMessages();
      }, INACTIVITY_TIMEOUT_MS);
    }
  };

  // Cleanup inactivity timer on unmount
  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  // Poll for sessions to keep the list updated
  const { data: sessionsData, refetch: refetchSessions } =
    trpc.agent.listSessions.useQuery(
      { projectSlug, version },
      {
        refetchOnMount: true,
      }
    );

  useEffect(() => {
    setSelectedSessionId(null);
    setMessages([]);
    setIsStreaming(false);
    setStreamingParts([]);
  }, [projectSlug]);

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
      }
    );

  // SSE subscription for real-time events
  trpc.agent.sessionEvents.useSubscription(
    {
      sessionId: selectedSessionId ?? "",
    },
    {
      enabled: !!selectedSessionId,
      onData: (trackedEvent) => {
        const event = trackedEvent.data;
        const innerData = event.data;

        // Reset inactivity timer on each event received
        resetInactivityTimer();

        switch (innerData.kind) {
          case "thinking.started":
            setIsStreaming(true);
            setIsWaiting(false);
            break;

          case "reasoning.delta":
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
            refetchMessages();
            onTaskComplete?.();
            break;
        }
      },
      onError: (err) => {
        console.error("[SessionEvents] Subscription error:", err);
        setIsStreaming(false);
        setIsWaiting(false);
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
    }
  }, [sessionMessages, selectedSessionId]);

  // Derive thinking state from streaming status or message heuristic
  const isThinking = isStreaming || isWaiting;

  const runTaskMutation = trpc.agent.runTask.useMutation({
    onSuccess: (data) => {
      if (data.sessionId) {
        setSelectedSessionId(data.sessionId);
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
    setIsWaiting(true);

    resetInactivityTimer();
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
    setSelectedSessionId(null);
    setMessages([]);
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
    handleSend,
    handleNewSession,
    handleDeleteSession,
    handleRevert,
    handleUnrevert,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
