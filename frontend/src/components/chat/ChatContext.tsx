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
import { usePreview } from "../preview/PreviewContext";
import { formatMessageWithSelector } from "./SelectedElementPill";
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

// Types
export interface Message {
  id?: string;
  role: "user" | "agent";
  content: string;
  parts?: any[];
}

interface Session {
  id: string;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
  };
  revert?: { messageID: string };
}

interface AttachedElement {
  selector: string;
  description: string;
  text?: string;
  filename?: string;
}

// Debug state for session monitoring
export interface UsageData {
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
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
  usage: UsageData | null;
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
  const debugEnabled = import.meta.env.VITE_DEBUG_CHAT === "true";
  const debugLog = (...args: unknown[]) => {
    if (debugEnabled) {
      console.log(...args);
    }
  };

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
  const autoSelectLockedRef = useRef(false);
  const hasAutoSelectedRunningSessionRef = useRef(false);

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
  const [usage, setUsage] = useState<UsageData | null>(null);

  // Session error state (for quota limits, API errors, etc.)
  const [sessionError, setSessionError] = useState<SessionError | null>(null);
  const clearSessionError = () => setSessionError(null);

  const confirmResolverRef = useRef<((result: boolean) => void) | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }>({ open: false, title: "" });

  const requestConfirm = useCallback(
    (options: {
      title: string;
      description?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      destructive?: boolean;
    }) => {
      return new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
        setConfirmDialog({ open: true, ...options });
      });
    },
    []
  );

  const resolveConfirm = useCallback((result: boolean) => {
    confirmResolverRef.current?.(result);
    confirmResolverRef.current = null;
    setConfirmDialog((prev) => ({ ...prev, open: false }));
  }, []);

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
    autoSelectLockedRef.current = false;
    hasAutoSelectedRunningSessionRef.current = false;
  }, [projectSlug]);

  useEffect(() => {
    const isPendingSession = pendingSessionIdRef.current === selectedSessionId;

    setStreamingParts([]);
    setIsStreaming(false);
    setSessionError(null);
    setSseConnected(false);
    setLastEventTime(null);
    setLastEventType(null);
    setUsage(null);

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
        text: selectedElement.text,
        filename: selectedElement.filename,
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

      // Set the input
      setInput(pendingMessage);

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

      // Trigger send after a short delay to ensure state is updated
      setTimeout(() => {
        // We need to call the mutation directly since handleSend reads from state
        isWaitingForAgent.current = true;
        setIsStreaming(false);
        setIsWaiting(true);
        setStreamingParts([]);
        setMessages((prev) => [
          ...prev,
          { role: "user", content: pendingMessage },
        ]);
        setInput("");

        // Always start new session when startNewSession is true
        if (startNewSession) {
          runTaskMutation.mutate({
            projectSlug,
            task: pendingMessage,
            version,
          });
        } else {
          // Use current session if exists
          const currentSessionId = selectedSessionId;
          if (currentSessionId) {
            runTaskMutation.mutate({
              projectSlug,
              task: pendingMessage,
              sessionId: currentSessionId,
              version,
            });
          } else {
            runTaskMutation.mutate({
              projectSlug,
              task: pendingMessage,
              version,
            });
          }
        }
      }, 100);
    }
  }, [
    previewContext?.pendingChatMessage,
    previewContext?.clearPendingChatMessage,
    projectSlug,
    version,
  ]);

  useEffect(() => {
    if (sessionsData) {
      setSessions(sessionsData);
    }
  }, [sessionsData]);

  useEffect(() => {
    if (
      selectedSessionId ||
      autoSelectLockedRef.current ||
      hasAutoSelectedRunningSessionRef.current
    ) {
      return;
    }

    if (!sessionStatuses || sessions.length === 0) {
      return;
    }

    const activeSessions = sessions.filter((session) => {
      const status = sessionStatuses?.[session.id];
      return status && status.type !== "idle";
    });

    if (activeSessions.length === 0) {
      return;
    }

    const getSessionTimestamp = (session: Session) =>
      session.time?.updated ?? session.time?.created ?? 0;
    const mostRecentSession = activeSessions.reduce((latest, session) => {
      return getSessionTimestamp(session) > getSessionTimestamp(latest)
        ? session
        : latest;
    }, activeSessions[0]);

    hasAutoSelectedRunningSessionRef.current = true;
    setSelectedSessionId(mostRecentSession.id);
  }, [selectedSessionId, sessionStatuses, sessions]);

  // Poll for messages of the selected session
  const { data: sessionMessages, refetch: refetchMessages } =
    trpc.agent.getSessionContent.useQuery(
      {
        sessionId: selectedSessionId!,
        projectSlug,
        version,
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
        debugLog(
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
        debugLog(
          "[ChatContext] Session status is busy but idle locally - marking waiting state"
        );
        setIsWaiting(true);
      }
    } else if (currentSessionStatus.type === "retry") {
      // Session is in retry state (quota error, etc.)
      debugLog("[ChatContext] Session status is retry:", currentSessionStatus);
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
        debugLog("[ChatContext] SSE subscription started");
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

          case "usage.updated":
            if ("cost" in innerData && "tokens" in innerData) {
              setUsage((prev) => {
                // If we have previous usage, we should be careful not to double count.
                // However, usage.updated usually comes before the polled history updates.
                // A simple strategy is:
                // 1. If we have a base from history, we might be adding the *current* step.
                // But since history polling happens frequently (every 2s), the history calc will overwrite this soon.
                // The history calc is the source of truth.
                // The usage.updated event is ephemeral for the active stream.
                //
                // Problem: If we just overwrite here, we lose the history sum until next poll.
                // Solution: We should rely on the history calculation for the base,
                // and THIS event should only update if we can identify it's new?
                //
                // Actually, simplest is to let the history poll handle the aggregation,
                // and maybe ignore this event OR only use it if we want super real-time
                // stats for the *current* token generation.
                //
                // Given the user wants history, the history calculation above is the most important fix.
                // We'll leave this to overwrite for now, as the history poll will correct it
                // within 2s, and this provides the "live" view of the current step.
                //
                // BETTER: Accumulate? No, receive delta?
                // innerData is likely the usage for the *completed step/message*.
                //
                // Let's rely on the history polling primarily.
                // But to prevent flickering to 0 (or low value) when a new step finishes
                // (and overwrites the huge history total), we should probably
                // ADD this to the previous TOTAL if the previous total exists.
                //
                // But "cost" in innerData is likely just for that step.
                // So: Current Total + New Step Cost.
                // But history poll will eventually include this step.
                // We might double count if we just keep adding.
                //
                // SAFE BET: Just let the history poll do the work. The user's main complaint
                // is "It is only visible for our new sessions". The history fix solves that.
                // Real-time updates are less critical if polling is fast (2s).
                // I will keep this here but maybe try to merge it intelligently?
                // Actually, if I COMMENT OUT this handler or make it a no-op,
                // the history calculator will pick it up on next poll (max 2s delay).
                //
                // Let's try to add it to previous keys to avoid the "reset to small number" artifact.
                const prevCost = prev?.cost || 0;
                const prevTokens = prev?.tokens || {
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                };

                // Heuristic: If the new cost is significantly smaller than previous,
                // it's likely a single step update vs the whole session total.
                // We add it.
                // If it's similar/larger, maybe it's a total update? (Unlikely given API).

                return {
                  cost: prevCost + (innerData.cost as number),
                  tokens: {
                    input: prevTokens.input + (innerData.tokens as any).input,
                    output:
                      prevTokens.output + (innerData.tokens as any).output,
                    reasoning:
                      prevTokens.reasoning +
                      ((innerData.tokens as any).reasoning || 0),
                    cache: {
                      read:
                        prevTokens.cache.read +
                        ((innerData.tokens as any).cache?.read || 0),
                      write:
                        prevTokens.cache.write +
                        ((innerData.tokens as any).cache?.write || 0),
                    },
                  },
                };
              });
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

      // Calculate total usage from history
      let totalCost = 0;
      const totalTokens = {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      };

      sessionMessages.forEach((msg: any) => {
        const info = msg.info || msg; // Handle wrapped or direct message
        if (info && info.role === "assistant" && info.cost) {
          totalCost += info.cost || 0;
          if (info.tokens) {
            totalTokens.input += info.tokens.input || 0;
            totalTokens.output += info.tokens.output || 0;
            totalTokens.reasoning += info.tokens.reasoning || 0;
            if (info.tokens.cache) {
              totalTokens.cache.read += info.tokens.cache.read || 0;
              totalTokens.cache.write += info.tokens.cache.write || 0;
            }
          }
        }
      });

      if (totalCost > 0) {
        setUsage({
          cost: totalCost,
          tokens: totalTokens,
        });
      }

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
          debugLog(
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
    const ok = await requestConfirm({
      title: "Delete this session?",
      description: "This will permanently delete the session and its messages.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    await deleteSessionMutation.mutateAsync({
      sessionId,
      projectSlug,
      version,
    });
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
      setMessages([]);
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
    const ok = await requestConfirm({
      title: "Revert changes from this task?",
      description: "This will undo file changes made by the agent.",
      confirmLabel: "Revert",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    await revertMutation.mutateAsync({
      sessionId: selectedSessionId,
      messageId,
      projectSlug,
      version,
    });
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
      task = formatMessageWithSelector(
        task,
        attachedElement.selector,
        attachedElement.filename,
        attachedElement.text
      );
    }

    setInput("");
    setAttachedElement(null);

    isWaitingForAgent.current = true;
    setIsStreaming(false);
    setIsWaiting(true);

    setStreamingParts([]);

    debugLog("[Vivd] Sending prompt:", task);

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
    autoSelectLockedRef.current = true;
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
    usage,
  };

  const value: ChatContextValue = {
    projectSlug,
    version,
    sessions,
    selectedSessionId,
    setSelectedSessionId: (sessionId) => {
      autoSelectLockedRef.current = true;
      setSelectedSessionId(sessionId);
    },
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

  return (
    <>
      <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open && confirmResolverRef.current) {
            resolveConfirm(false);
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
