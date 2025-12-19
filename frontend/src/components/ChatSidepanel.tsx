import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { SessionList } from "./chat/SessionList";
import { MessageList } from "./chat/MessageList";
import { ElementSelector } from "./chat/ElementSelector";
import {
  SelectedElementPill,
  formatMessageWithSelector,
} from "./chat/SelectedElementPill";
import { usePreview } from "./preview/PreviewContext";

interface ChatPanelProps {
  projectSlug: string;
  version?: number;
  onTaskComplete?: () => void;
  onClose?: () => void;
}

interface Message {
  id?: string;
  role: "user" | "agent";
  content: string;
  parts?: any[];
}

export function ChatPanel({
  projectSlug,
  version,
  onTaskComplete,
  onClose,
}: ChatPanelProps) {
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
  const [attachedElement, setAttachedElement] = useState<{
    selector: string;
    description: string;
  } | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<{ id: string }[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [isReverted, setIsReverted] = useState(false);

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
          `[ChatSidepanel] No events received for ${
            INACTIVITY_TIMEOUT_MS / 1000
          }s while waiting/streaming. Last event at: ${new Date(
            lastEventTimeRef.current
          ).toISOString()}`
        );
        console.warn("[ChatSidepanel] Auto-recovering from stuck state...");
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
    setIsReverted(false);
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
  // Only poll when NOT streaming, and use a slower interval
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
        // tracked() wraps the event - access the actual data
        // trackedEvent.data is the AgentEvent object
        // AgentEvent.data is the specific event payload (AgentEventData)
        const event = trackedEvent.data;
        const innerData = event.data;

        // Reset inactivity timer on each event received
        resetInactivityTimer();

        switch (innerData.kind) {
          case "thinking.started":
            setIsStreaming(true);
            setIsWaiting(false); // Stop waiting state once streaming starts
            // Don't clear parts here! This event fires for every new thought block.
            // keeping history of the current stream.
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
                  id: toolId, // Use toolId as partId for tools
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
            // Final refetch to get complete message content
            refetchMessages();
            onTaskComplete?.();
            break;
        }
      },
      onError: (err) => {
        console.error("[SessionEvents] Subscription error:", err);
        // Fallback to polling on subscription error
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
        // Set waiting flag to enable subscription and thinking state
        isWaitingForAgent.current = true;
      }
      // Note: We don't call onTaskComplete here anymore, we wait for session.completed event
    },
    onError: (error) => {
      // If runTask fails immediately (network error to backend)
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
        // If the deleted session was selected, deselect it or select another one
        // Note: Logic to handle selected session update can be improved
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
      // Refetch messages after revert
      refetchSessions();
      // Refresh the iframe preview
      onTaskComplete?.();
      // Track reverted state
      setIsReverted(true);
    },
  });

  const unrevertMutation = trpc.agent.unrevertSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      // Refresh the iframe preview
      onTaskComplete?.();
      // Clear reverted state
      setIsReverted(false);
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
    // Allow sending if there's input OR an attached element
    if ((!input.trim() && !attachedElement) || runTaskMutation.isPending)
      return;

    // Build the task message, including selector if element is attached
    let task = input.trim() || "I want to change this element";
    if (attachedElement) {
      task = formatMessageWithSelector(task, attachedElement.selector);
    }

    setInput("");
    setAttachedElement(null); // Clear attached element after sending

    // Set waiting flag immediately
    isWaitingForAgent.current = true;
    setIsWaiting(true);

    // Start inactivity timer for stuck state detection
    resetInactivityTimer();

    // Clear previous streaming parts for new request
    setStreamingParts([]);

    // Log the sent prompt
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
      // New session
      setMessages((prev) => [...prev, { role: "user", content: task }]);
      runTaskMutation.mutate({ projectSlug, task, version });
    }
  };

  const handleNewSession = () => {
    setSelectedSessionId(null);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-6 py-4 border-b flex justify-between items-center bg-background z-10">
        <div className="flex flex-col gap-2 w-full">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Agent Chat</h2>
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <span className="sr-only">Close</span>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <SessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
            onDeleteSession={handleDeleteSession}
            onNewSession={handleNewSession}
          />
        </div>
      </div>

      <MessageList
        messages={messages}
        isThinking={isThinking}
        isLoading={runTaskMutation.isPending}
        onRevert={handleRevert}
        onRestore={handleUnrevert}
        isReverted={isReverted}
        // Pass streaming state
        streamingParts={streamingParts}
        // Element selector integration
        onSuggestionClick={(suggestion) => setInput(suggestion)}
        onEnterSelectorMode={() => setSelectorMode?.(!selectorMode)}
        selectorModeAvailable={!!setSelectorMode}
        selectorMode={selectorMode}
        // Input props for empty state
        input={input}
        setInput={setInput}
        onSend={handleSend}
        attachedElement={attachedElement}
        onRemoveElement={() => setAttachedElement(null)}
      />

      {/* Only show bottom input when there are messages (otherwise input is in EmptyStatePrompt) */}
      {messages.length > 0 && (
        <div className="p-4 border-t mt-auto">
          {/* Show attached element pill above input */}
          {attachedElement && (
            <div className="mb-2">
              <SelectedElementPill
                selector={attachedElement.selector}
                description={attachedElement.description}
                onRemove={() => setAttachedElement(null)}
              />
            </div>
          )}
          <div className="flex gap-2 items-end">
            {setSelectorMode && (
              <ElementSelector
                isActive={selectorMode}
                onToggle={() => setSelectorMode(!selectorMode)}
                disabled={runTaskMutation.isPending}
              />
            )}
            <div className="flex-1 flex gap-2 items-end">
              <textarea
                className="flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none max-h-[200px]"
                placeholder={
                  selectorMode
                    ? "Click an element in the preview..."
                    : attachedElement
                    ? "Describe what you want to change..."
                    : "Type a task..."
                }
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={runTaskMutation.isPending}
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={
                  runTaskMutation.isPending ||
                  (!input.trim() && !attachedElement)
                }
                size="icon"
                className="h-10 w-10 shrink-0"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
