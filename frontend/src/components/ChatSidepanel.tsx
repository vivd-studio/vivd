import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { useState, useEffect } from "react";
import { SessionList } from "./chat/SessionList";
import { MessageList } from "./chat/MessageList";
import { MessageInput } from "./chat/MessageInput";

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
  // TODO: Make this event driven and not with polling!!
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
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

  const deleteSessionMutation = trpc.agent.deleteSession.useMutation({
    onSuccess: () => {
      refetchSessions();
      if (sessions.length > 0) {
        // If the deleted session was selected, deselect it or select another one
        // Note: Logic to handle selected session update can be improved
      }
    },
  });

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string
  ) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this session?")) {
      await deleteSessionMutation.mutateAsync({ sessionId });
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setMessages([]);
      }
    }
  };

  const handleSend = () => {
    if (!input.trim() || runTaskMutation.isPending) return;

    const task = input;
    setInput("");

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
      />

      <MessageInput
        input={input}
        setInput={setInput}
        onSend={handleSend}
        isLoading={runTaskMutation.isPending}
      />
    </div>
  );
}
