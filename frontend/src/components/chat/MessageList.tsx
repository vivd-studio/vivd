import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, ChevronDown, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Message {
  id?: string;
  role: "user" | "agent";
  content: string;
  parts?: any[];
}

interface MessageListProps {
  messages: Message[];
  isThinking: boolean;
  isLoading: boolean;
  onRevert?: (messageId: string) => void;
  onRestore?: () => void;
  isReverted?: boolean;
}

export function MessageList({
  messages,
  isThinking,
  isLoading,
  onRevert,
  onRestore,
  isReverted,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
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
            {/* Revert button above user messages - backend handles finding assistant messages */}
            {msg.role === "user" && msg.id && onRevert && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground h-6 px-2"
                onClick={() => onRevert(msg.id!)}
              >
                <Undo2 className="w-3 h-3 mr-1" />
                Revert to before this
              </Button>
            )}
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
        {(isLoading || isThinking) && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Agent is working...</span>
            </div>
          </div>
        )}
        {/* Restore button when session is reverted */}
        {isReverted && onRestore && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={onRestore}
              className="text-sm"
            >
              <Undo2 className="w-4 h-4 mr-2" />
              Restore reverted changes
            </Button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
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
