import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, ChevronDown, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyStatePrompt } from "./EmptyStatePrompt";
import { ElementRefPill, parseElementRef } from "./SelectedElementPill";
import { useChatContext } from "./ChatContext";

export function MessageList() {
  const {
    messages,
    isThinking,
    isLoading,
    handleRevert,
    handleUnrevert,
    isReverted,
    streamingParts,
    setInput,
    selectorMode,
    setSelectorMode,
    selectorModeAvailable,
    input,
    handleSend,
    attachedElement,
    setAttachedElement,
  } = useChatContext();

  const onSuggestionClick = (suggestion: string) => setInput(suggestion);
  const onEnterSelectorMode = () => setSelectorMode?.(!selectorMode);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only scroll when there are messages - don't scroll on empty session
    if (
      messages.length > 0 ||
      isThinking ||
      (streamingParts && streamingParts.length > 0)
    ) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isThinking, streamingParts]);

  return (
    <ScrollArea className="flex-1 p-6" ref={scrollRef}>
      <div className="flex flex-col gap-6 pb-4">
        {messages.length === 0 && (
          <EmptyStatePrompt
            onSuggestionClick={onSuggestionClick}
            onEnterSelectorMode={onEnterSelectorMode}
            selectorModeAvailable={selectorModeAvailable}
            selectorMode={selectorMode}
            input={input}
            setInput={setInput}
            onSend={handleSend}
            isLoading={isLoading}
            attachedElement={attachedElement}
            onRemoveElement={() => setAttachedElement(null)}
          />
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
              {isUser && msg.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground h-6 px-2"
                  onClick={() => handleRevert(msg.id!)}
                >
                  <Undo2 className="w-3 h-3 mr-1" />
                  Revert to before this
                </Button>
              )}

              {/* User Message Bubble */}
              {isUser ? (
                (() => {
                  const { cleanMessage, elementHtml } = parseElementRef(
                    msg.content
                  );
                  return (
                    <div className="rounded-lg px-4 py-2 max-w-[90%] bg-muted text-foreground">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ node, ...props }) => (
                            <p {...props} className="m-0" />
                          ),
                          a: ({ node, ...props }) => (
                            <a
                              {...props}
                              className="underline hover:text-foreground/80"
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                          code: ({ node, ...props }) => (
                            <code
                              {...props}
                              className="bg-foreground/10 rounded px-1"
                            />
                          ),
                          pre: ({ node, ...props }) => (
                            <pre
                              {...props}
                              className="bg-foreground/10 p-2 rounded overflow-x-auto"
                            />
                          ),
                        }}
                      >
                        {cleanMessage}
                      </ReactMarkdown>
                      {elementHtml && (
                        <div className="mt-2 pt-2 border-t border-foreground/10">
                          <ElementRefPill html={elementHtml} />
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                /* Agent Message Construction - Split into parts */
                <div className="flex flex-col gap-2 max-w-[90%] w-full items-start overflow-hidden">
                  {msg.parts && msg.parts.length > 0 ? (
                    msg.parts.map((part: any, pIndex: number) => (
                      <MessagePartBubble key={pIndex} part={part} />
                    ))
                  ) : (
                    /* Fallback for legacy messages */
                    <div className="rounded-lg px-4 py-2 w-full prose prose-sm dark:prose-invert max-w-none wrap-break-word overflow-x-auto">
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

        {/* Streaming / Loading State - only show when we have messages (not in empty state) */}
        {messages.length > 0 && (isLoading || isThinking) && (
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
        {isReverted && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnrevert}
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
      <div className="rounded-lg px-3 py-2 text-xs font-mono w-full max-w-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {part.status === "running" ? (
              <Loader2 className="w-3 h-3 animate-spin opacity-70" />
            ) : part.status === "error" ? (
              <span>❌</span>
            ) : (
              <span>✅</span>
            )}
            <span className="opacity-70">Tool Call:</span>
            <span className="font-semibold">{part.tool}</span>
          </div>
          <span className="opacity-50 text-[10px] uppercase tracking-wider">
            {part.status}
          </span>
        </div>
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
      <div className="rounded-lg px-4 py-2 w-full prose prose-sm dark:prose-invert max-w-none wrap-break-word overflow-x-auto">
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
