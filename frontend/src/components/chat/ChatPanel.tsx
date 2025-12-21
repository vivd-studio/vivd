import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { SessionList } from "./SessionList";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ChatProvider, useChatContext } from "./ChatContext";

interface ChatPanelProps {
  projectSlug: string;
  version?: number;
  onTaskComplete?: () => void;
  onClose?: () => void;
}

// Inner component that uses the context
function ChatPanelContent({ onClose }: { onClose?: () => void }) {
  const {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    handleDeleteSession,
    handleNewSession,
    messages,
  } = useChatContext();

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

      <MessageList />

      {/* Only show bottom input when there are messages (otherwise input is in EmptyStatePrompt) */}
      {messages.length > 0 && <ChatInput />}
    </div>
  );
}

// Main component that wraps with provider
export function ChatPanel({
  projectSlug,
  version,
  onTaskComplete,
  onClose,
}: ChatPanelProps) {
  return (
    <ChatProvider
      projectSlug={projectSlug}
      version={version}
      onTaskComplete={onTaskComplete}
    >
      <ChatPanelContent onClose={onClose} />
    </ChatProvider>
  );
}
