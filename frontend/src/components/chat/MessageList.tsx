import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, ChevronDown, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  streamingParts?: any[];
}

export function MessageList({
  messages,
  isThinking,
  isLoading,
  onRevert,
  onRestore,
  isReverted,
  streamingParts,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, streamingParts]);

  return (
    <ScrollArea className="flex-1 p-6" ref={scrollRef}>
      <div className="flex flex-col gap-6 pb-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground mt-8">
            <p>Describe a task for the agent to execute.</p>
            <p className="text-sm mt-2">
              Example: "Change the headline color to blue"
            </p>
          </div>
        )}
        {messages.map((msg, i) => {
          // Skip empty messages (no content and no parts)
          if (!msg.content && (!msg.parts || msg.parts.length === 0)) {
            return null;
          }

          const isUser = msg.role === "user";

          return (
            <div
              key={i}
              className={`flex flex-col gap-1 ${
                isUser ? "items-end" : "items-start"
              }`}
            >
              {/* Revert button above user messages - backend handles finding assistant messages */}
              {isUser && msg.id && onRevert && (
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

              {/* User Message Bubble */}
              {isUser ? (
                <div className="rounded-lg px-4 py-2 max-w-[90%] bg-primary text-primary-foreground">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ node, ...props }) => (
                        <p {...props} className="m-0" />
                      ),
                      a: ({ node, ...props }) => (
                        <a
                          {...props}
                          className="underline text-primary-foreground/90 hover:text-primary-foreground"
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                      code: ({ node, ...props }) => (
                        <code
                          {...props}
                          className="bg-primary-foreground/20 rounded px-1"
                        />
                      ),
                      pre: ({ node, ...props }) => (
                        <pre
                          {...props}
                          className="bg-primary-foreground/20 p-2 rounded overflow-x-auto"
                        />
                      ),
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                /* Agent Message Construction - Split into parts */
                <div className="flex flex-col gap-2 max-w-[90%] w-full items-start">
                  {msg.parts && msg.parts.length > 0 ? (
                    msg.parts.map((part: any, pIndex: number) => (
                      <MessagePartBubble key={pIndex} part={part} />
                    ))
                  ) : (
                    /* Fallback for legacy messages */
                    <div className="bg-muted rounded-lg px-4 py-2 w-full prose prose-sm dark:prose-invert max-w-none wrap-break-word">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Streaming / Loading State */}
        {(isLoading || isThinking) && (
          <div className="flex justify-start w-full max-w-[90%]">
            <div className="flex flex-col gap-2 w-full items-start">
              {/* Immediate Feedback: Show a fake active reasoning block if waiting but no parts yet */}
              {isThinking &&
                (!streamingParts || streamingParts.length === 0) && (
                  <ThinkingBlock
                    text=""
                    isStreaming={true}
                    defaultOpen={false}
                    label="Thinking Process"
                  />
                )}

              {/* Streaming Parts */}
              {streamingParts &&
                streamingParts.map((part, idx) => {
                  const isLast = idx === streamingParts.length - 1;
                  return (
                    <MessagePartBubble
                      key={idx}
                      part={part}
                      isStreaming={true}
                      isLast={isLast}
                      defaultOpen={false} // Open if it's the active one
                    />
                  );
                })}
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

function MessagePartBubble({
  part,
  isStreaming = false,
  isLast = false,
  defaultOpen = false,
}: {
  part: any;
  isStreaming?: boolean;
  isLast?: boolean;
  defaultOpen?: boolean;
}) {
  if (part.type === "reasoning") {
    // Determine active state: must be streaming AND be the last item
    const isActive = isStreaming && isLast;

    return (
      <ThinkingBlock
        text={part.text}
        isStreaming={isActive} // Only show spinner if active
        defaultOpen={defaultOpen}
        label={isActive ? "Thinking Process" : "Thought"} // Change label based on state
      />
    );
  }
  if (part.type === "tool") {
    return (
      <div className="bg-muted border rounded-lg px-3 py-2 text-xs font-mono w-full max-w-md">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 opacity-70">
            {part.status === "running" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : part.status === "error" ? (
              <span>❌</span>
            ) : (
              <span>✅</span>
            )}
            <span>Tool Call</span>
          </div>
          <span className="opacity-50 text-[10px] uppercase tracking-wider">
            {part.status}
          </span>
        </div>

        <div className="font-semibold">{part.tool}</div>
        {part.title && (
          <div className="text-muted-foreground mt-1 truncate">
            {part.title}
          </div>
        )}
      </div>
    );
  }
  if (part.type === "text") {
    return (
      <div className="bg-muted rounded-lg px-4 py-2 w-full prose prose-sm dark:prose-invert max-w-none wrap-break-word">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
      </div>
    );
  }
  return null;
}

function ThinkingBlock({
  text,
  defaultOpen = false,
  isStreaming = false,
  label = "Thinking Process",
}: {
  text: string;
  defaultOpen?: boolean;
  isStreaming?: boolean;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="w-full max-w-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-xs font-medium py-1 px-1"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span className="flex items-center gap-2">
          {isStreaming && <Loader2 className="w-3 h-3 animate-spin" />}
          {label}
        </span>
      </button>
      {isOpen && (
        <div className="mt-1 ml-1 pl-3 border-l-2 border-muted text-muted-foreground text-sm whitespace-pre-wrap py-1">
          {text || "..."}
        </div>
      )}
    </div>
  );
}
