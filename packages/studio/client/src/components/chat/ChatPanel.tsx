import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { formatDollarsAsCredits } from "@vivd/shared";
import { SessionList } from "./SessionList";
import { MessageList } from "./MessageList";
import { ChatInputRegion } from "./ChatInputRegion";
import { OpencodeChatProvider } from "@/features/opencodeChat";
import { ChatProvider, useChatContext } from "./ChatContext";
import type { SessionDebugState } from "./chatTypes";
import { useOptionalPreview } from "../preview/PreviewContext";

interface ChatPanelProps {
  projectSlug: string;
  version?: number;
  onTaskComplete?: () => void;
  onClose?: () => void;
}

// Debug display component for session state (admin only, toggleable)
function SessionDebugDisplay({ debug }: { debug: SessionDebugState }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isAdmin = import.meta.env.VITE_DEBUG_CHAT === "true";

  // Only show to admin users
  if (!isAdmin) return null;

  return (
    <div className="border-t bg-muted/50 text-xs font-mono text-muted-foreground">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-1.5 flex items-center justify-between hover:bg-muted/80 transition-colors"
      >
        <span className="font-semibold text-foreground/70">Debug</span>
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5" />
        )}
      </button>
      {isExpanded && (
        <div className="px-4 pb-2 space-y-1">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>Session ID:</span>
            <span className="truncate">
              {debug.selectedSessionId ?? "none"}
            </span>

            <span>SSE Connected:</span>
            <span
              className={debug.sseConnected ? "text-green-600" : "text-red-600"}
            >
              {debug.sseConnected ? "✓ Yes" : "✗ No"}
            </span>

            <span>Streaming:</span>
            <span className={debug.isStreaming ? "text-blue-600" : ""}>
              {debug.isStreaming ? "Yes" : "No"}
            </span>

            <span>Waiting:</span>
            <span className={debug.isWaiting ? "text-amber-600" : ""}>
              {debug.isWaiting ? "Yes" : "No"}
            </span>

            <span>Thinking:</span>
            <span className={debug.isThinking ? "text-purple-600" : ""}>
              {debug.isThinking ? "Yes" : "No"}
            </span>

            <span>Messages:</span>
            <span>{debug.messagesCount}</span>

            <span>Streaming Parts:</span>
            <span>{debug.streamingPartsCount}</span>

            <span>Last Event:</span>
            <span className="truncate">{debug.lastEventType ?? "none"}</span>

            <span>Event Time:</span>
            <span className="truncate">
              {debug.lastEventTime
                ? new Date(debug.lastEventTime).toLocaleTimeString()
                : "never"}
            </span>

            {debug.usage && (
              <>
                <div className="col-span-2 my-1 border-t border-dashed border-border/50" />

                <span>Credits:</span>
                <span className="font-semibold text-green-600">
                  {formatDollarsAsCredits(debug.usage.cost)}
                </span>

                <span>Input Tokens:</span>
                <span>{debug.usage.tokens.input}</span>

                <span>Output Tokens:</span>
                <span>{debug.usage.tokens.output}</span>

                <span>Reasoning:</span>
                <span>{debug.usage.tokens.reasoning}</span>

                <span>Cache Read:</span>
                <span>{debug.usage.tokens.cache.read}</span>

                <span>Cache Write:</span>
                <span>{debug.usage.tokens.cache.write}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Inner component that uses the context
function ChatPanelContent({ onClose }: { onClose?: () => void }) {
  const previewContext = useOptionalPreview();
  const {
    sessions,
    sessionsLoading,
    selectedSessionId,
    setSelectedSessionId,
    handleDeleteSession,
    messageCount,
    activeQuestionRequest,
    activePermissionRequest,
    sessionDebugState,
    setSelectorMode,
  } = useChatContext();
  const sessionHistoryOpen = previewContext?.sessionHistoryOpen ?? false;
  const setSessionHistoryOpen =
    previewContext?.setSessionHistoryOpen ?? (() => undefined);
  const showQuestionFocusOverlay = Boolean(
    activeQuestionRequest || activePermissionRequest,
  );

  // Wrap onClose to also exit selector mode
  const handleClose = () => {
    if (setSelectorMode) {
      setSelectorMode(false);
    }
    setSessionHistoryOpen(false);
    onClose?.();
  };

  const handleSelectSession = (sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    setSessionHistoryOpen(false);
  };

  return (
    <div className="relative flex h-full flex-col bg-background">
      {onClose ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end p-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="pointer-events-auto h-9 w-9 rounded-full bg-background shadow-sm"
          >
            <span className="sr-only">Close</span>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {sessionHistoryOpen ? (
        <div className="flex min-h-0 flex-1 flex-col px-3 py-3 md:px-4">
          <SessionList
            sessions={sessions}
            sessionsLoading={sessionsLoading}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
          />
        </div>
      ) : (
        <>
          <MessageList />

          {showQuestionFocusOverlay ? (
            <div
              aria-hidden="true"
              data-testid="chat-question-focus-overlay"
              className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(to_top,rgba(0,0,0,0.36),rgba(0,0,0,0.22)_38%,rgba(0,0,0,0.08)_70%,rgba(0,0,0,0.02))] backdrop-blur-[1.5px]"
            />
          ) : null}

          {messageCount > 0 ? (
            <div className="relative z-20">
              <ChatInputRegion />
            </div>
          ) : null}

          {/* Debug display for session state (admin only) */}
          <SessionDebugDisplay debug={sessionDebugState} />
        </>
      )}
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
    <OpencodeChatProvider projectSlug={projectSlug} version={version}>
      <ChatProvider
        projectSlug={projectSlug}
        version={version}
        onTaskComplete={onTaskComplete}
      >
        <ChatPanelContent onClose={onClose} />
      </ChatProvider>
    </OpencodeChatProvider>
  );
}

// Export content component for use when ChatProvider is already present
export { ChatPanelContent };
