import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { Loader2, Send, X, ChevronRight, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface ChatPanelProps {
  projectSlug: string;
  onTaskComplete?: () => void;
  onClose?: () => void;
}

interface Message {
  role: "user" | "agent";
  content: string;
  parts?: any[];
}

export function ChatPanel({
  projectSlug,
  onTaskComplete,
  onClose,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sessions, setSessions] = useState<{ id: string }[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  // Poll for sessions to keep the list updated
  const { data: sessionsData, refetch: refetchSessions } =
    trpc.agent.listSessions.useQuery(
      { projectSlug },
      {
        // Ensure we refetch when the component mounts or slug changes
        refetchOnMount: true,
        // Also invalidating queries often helps but for now relying on query key (which includes projectSlug)
      }
    );

  // When projectSlug changes, we should reset selected session to avoid showing a session from another project
  useEffect(() => {
    setSelectedSessionId(null);
    setMessages([]);
  }, [projectSlug]);

  useEffect(() => {
    if (sessionsData) {
      // @ts-ignore
      setSessions(sessionsData);
      if (!selectedSessionId && sessionsData.length > 0) {
        // Optional: auto-select recent session
        // const lastSession = sessionsData[sessionsData.length - 1];
        // setSelectedSessionId(lastSession.id);
      }
    }
  }, [sessionsData, selectedSessionId]);

  // Poll for messages of the selected session
  const { data: sessionMessages } = trpc.agent.getSessionContent.useQuery(
    { sessionId: selectedSessionId! },
    {
      enabled: !!selectedSessionId,
      refetchInterval: 1000, // Poll every second for real-time-ish updates
    }
  );

  useEffect(() => {
    if (sessionMessages && selectedSessionId) {
      const mappedMessages: Message[] = sessionMessages.map((msg: any) => {
        const role = msg.info?.role === "assistant" ? "agent" : "user";
        // Collect text content
        const textContent =
          msg.parts
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n") || "";

        return { role, content: textContent, parts: msg.parts };
      });
      setMessages(mappedMessages);
    }
  }, [sessionMessages, selectedSessionId]);

  // Derive thinking state: if last message is from user, agent is thinking.
  // Also if the last message is from agent but ends with a tool call that might be running (harder to tell without status).
  // Simple heuristic: User last -> Thinking.
  const isThinking =
    messages.length > 0 && messages[messages.length - 1].role === "user";

  const runTaskMutation = trpc.agent.runTask.useMutation({
    onSuccess: (data) => {
      if (data.sessionId) {
        setSelectedSessionId(data.sessionId);
        refetchSessions();
      }
      onTaskComplete?.();
    },
    onError: (error) => {
      // If runTask fails immediately (network error to backend)
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Error: ${error.message}` },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || runTaskMutation.isPending) return;

    const task = input;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    if (selectedSessionId) {
      setMessages((prev) => [...prev, { role: "user", content: task }]);
      runTaskMutation.mutate({
        projectSlug,
        task,
        sessionId: selectedSessionId,
      });
    } else {
      // New session
      setMessages((prev) => [...prev, { role: "user", content: task }]);
      runTaskMutation.mutate({ projectSlug, task });
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
          {/* Session Tabs */}
          <div className="flex gap-2 w-full overflow-x-auto pb-2 scrollbar-thin">
            <Button
              variant={selectedSessionId === null ? "secondary" : "ghost"}
              size="sm"
              className="text-xs shrink-0"
              onClick={() => {
                setSelectedSessionId(null);
                setMessages([]);
              }}
            >
              + New Session
            </Button>
            {sessions.map((session: any) => (
              <Button
                key={session.id}
                variant={
                  selectedSessionId === session.id ? "secondary" : "ghost"
                }
                size="sm"
                className="text-xs shrink-0 max-w-[120px] truncate"
                onClick={() => {
                  setSelectedSessionId(session.id);
                  // messages will be fetched by the query
                }}
              >
                {session.id.slice(0, 8)}...
              </Button>
            ))}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6" ref={scrollRef}>
        <div className="flex flex-col gap-4 pb-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground mt-8">
              <p>Describe a task for the agent to execute.</p>
              <p className="text-sm mt-2">
                Example: "Change the headline color to blue"
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex flex-col gap-1 ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`rounded-lg px-4 py-2 max-w-[90%] whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {/* Render parts if available to show tools/reasoning */}
                {msg.parts && msg.parts.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {msg.parts.map((part: any, pIndex: number) => {
                      if (part.type === "text")
                        return <span key={pIndex}>{part.text}</span>;
                      if (part.type === "reasoning")
                        return <ThinkingBlock key={pIndex} text={part.text} />;
                      if (part.type === "tool")
                        return (
                          <div
                            key={pIndex}
                            className="text-xs bg-black/10 dark:bg-white/10 p-2 rounded flex items-center gap-2 font-mono"
                          >
                            <span>🛠️ {part.tool}</span>
                            {/* Show input if needed, or status */}
                          </div>
                        );
                      return null;
                    })}
                  </div>
                ) : (
                  msg.content ||
                  (msg.role === "agent" ? (
                    <span className="text-muted-foreground italic flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
                    </span>
                  ) : null)
                )}
              </div>
            </div>
          ))}
          {(runTaskMutation.isPending || isThinking) && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Agent is working...</span>
              </div>
            </div>
          )}
          {/* Check if the last message from agent is potentially thinking: tricky with polling.
                        We can add a visual indicator if polling tells us something is happening,
                        but currently we only get messages.
                     */}
        </div>
      </ScrollArea>

      <div className="p-4 border-t mt-auto">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            className="flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none max-h-[200px]"
            placeholder="Type a task..."
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={runTaskMutation.isPending}
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={runTaskMutation.isPending || !input.trim()}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span className="italic">Thinking Process</span>
      </button>
      {isOpen && (
        <div className="mt-1 pl-4 border-l-2 border-muted text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
