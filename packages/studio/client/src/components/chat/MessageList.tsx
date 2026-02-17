import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  Undo2,
  AlertTriangle,
  AlertCircle,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyStatePrompt } from "./EmptyStatePrompt";
import {
  ElementRefPill,
  DroppedImagePill,
  AttachedFileRefPill,
  parseVivdInternalTags,
} from "./SelectedElementPill";
import { useChatContext } from "./ChatContext";

export function MessageList() {
  const {
    messages,
    isThinking,
    isStreaming,
    isWaiting,
    isLoading,
    isSessionHydrating,
    handleRevert,
    handleUnrevert,
    isReverted,
    streamingParts,
    setInput,
    sessionError,
    clearSessionError,
    usageLimitStatus,
    isUsageBlocked,
  } = useChatContext();

  // Track dismissed warnings for this session
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

  const onSuggestionClick = (suggestion: string) => setInput(suggestion);

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
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="flex flex-col gap-6 px-3 pt-4 pb-4 md:px-6 md:pt-6 md:pb-6">
        {messages.length === 0 &&
          (isSessionHydrating ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mb-3" />
              <div className="text-sm">Loading session…</div>
            </div>
          ) : (
            <EmptyStatePrompt onSuggestionClick={onSuggestionClick} />
          ))}
        {messages.map((msg, i) => {
          // Skip empty messages (no content and no parts)
          if (!msg.content && (!msg.parts || msg.parts.length === 0)) {
            return null;
          }

          // Skip agent messages that have parts currently being rendered in streamingParts
          // This prevents duplicate Thought/Tool Call blocks during streaming
          const isLastMessage = i === messages.length - 1;
          if (isLastMessage && msg.role === "agent" && isStreaming) {
            return null;
          }

          // Also skip if any part of this message overlaps with current streaming parts
          // This handles cases where polling returns partial data while still streaming
          if (
            msg.role === "agent" &&
            isStreaming &&
            msg.parts &&
            streamingParts &&
            streamingParts.length > 0
          ) {
            const streamingPartIds = new Set(streamingParts.map((p) => p.id));
            const hasOverlap = msg.parts.some(
              (p: any) => p.id && streamingPartIds.has(p.id),
            );
            if (hasOverlap) {
              return null;
            }
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
                  // Parse all vivd-internal tags (unified for images and element refs)
                  const { cleanMessage, internalTags } = parseVivdInternalTags(
                    msg.content,
                  );

                  // Separate by type
                  const imageTags = internalTags.filter(
                    (t) => t.type === "dropped-file",
                  );
                  const fileTags = internalTags.filter(
                    (t) => t.type === "attached-file",
                  );
                  const elementTag = internalTags.find(
                    (t) => t.type === "element-ref",
                  );
                  const hasElementRef =
                    Boolean(elementTag?.selector) ||
                    Boolean(elementTag?.["source-file"]);

                  return (
                    <div className="rounded-lg px-4 py-2 max-w-[90%] min-w-0 overflow-x-hidden bg-muted text-foreground">
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
                          code: (props: any) => {
                            const { inline, className, ...rest } = props;
                            return (
                              <code
                                {...rest}
                                className={`${
                                  inline
                                    ? "bg-foreground/10 rounded px-1 break-words"
                                    : "whitespace-pre-wrap break-words"
                                } ${className ?? ""}`}
                              />
                            );
                          },
                          pre: ({ node, className, ...props }) => (
                            <pre
                              {...props}
                              className={`bg-foreground/10 p-2 rounded max-w-full overflow-x-auto whitespace-pre-wrap break-words ${
                                className ?? ""
                              }`}
                            />
                          ),
                        }}
                      >
                        {cleanMessage}
                      </ReactMarkdown>
                      {/* Show all attachment pills (images, files, and element refs) */}
                      {(imageTags.length > 0 ||
                        fileTags.length > 0 ||
                        hasElementRef) && (
                        <div className="mt-2 pt-2 border-t border-foreground/10 flex flex-wrap gap-1.5">
                          {imageTags.map((tag, idx) => (
                            <DroppedImagePill
                              key={`img-${idx}`}
                              filename={tag.filename || "image"}
                            />
                          ))}
                          {fileTags.map((tag, idx) => (
                            <AttachedFileRefPill
                              key={`file-${idx}`}
                              filename={tag.filename || "file"}
                            />
                          ))}
                          {hasElementRef && (
                            <ElementRefPill
                              key="element"
                              selector={elementTag?.selector}
                              sourceFile={elementTag?.["source-file"]}
                              sourceLoc={elementTag?.["source-loc"]}
                            />
                          )}
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
                    <div className="rounded-lg px-4 py-2 w-full min-w-0 prose prose-sm dark:prose-invert max-w-none break-words overflow-x-hidden">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          pre: ({ node, className, ...props }) => (
                            <pre
                              {...props}
                              className={`max-w-full overflow-x-auto whitespace-pre-wrap break-words ${
                                className ?? ""
                              }`}
                            />
                          ),
                        }}
                      >
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
                    />
                  );
                })}

              {/* Status indicator with animated dots */}
              <StatusIndicator
                isWaiting={isWaiting}
                streamingParts={streamingParts}
              />
            </div>
          </div>
        )}

        {/* Usage Limit Blocked Banner */}
        {isUsageBlocked && usageLimitStatus && (
          <div className="flex justify-center py-2">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 max-w-[90%] w-full">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-destructive">
                  Usage Limit Reached
                </div>
                {usageLimitStatus.warnings.map((warning, i) => (
                  <p
                    key={i}
                    className="text-xs text-muted-foreground mt-1 break-words"
                  >
                    {warning}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Usage Warning Banner (approaching limits) */}
        {!isUsageBlocked &&
          usageLimitStatus?.warnings &&
          usageLimitStatus.warnings.length > 0 &&
          !dismissedWarnings && (
            <div className="flex justify-center py-2">
              <div className="flex items-start gap-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 max-w-[90%] w-full">
                <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-yellow-700 dark:text-yellow-500">
                    Approaching Usage Limit
                  </div>
                  {usageLimitStatus.warnings.map((warning, i) => (
                    <p
                      key={i}
                      className="text-xs text-muted-foreground mt-1 break-words"
                    >
                      {warning}
                    </p>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-6 w-6 p-0"
                  onClick={() => setDismissedWarnings(true)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

        {/* Session Error Display */}
        {sessionError && (
          <div className="flex justify-center py-2">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 max-w-[90%] w-full">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-destructive">
                  {sessionError.type === "retry"
                    ? "Temporary Issue"
                    : "Session Error"}
                </div>
                <p className="text-xs text-muted-foreground mt-1 break-words">
                  {sessionError.message}
                </p>
                {sessionError.attempt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Attempt #{sessionError.attempt}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 h-6 w-6 p-0"
                onClick={clearSessionError}
              >
                <X className="w-4 h-4" />
              </Button>
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

        {/* Subtle "Done" indicator when generation is complete */}
        {messages.length > 0 &&
          messages[messages.length - 1].role === "agent" &&
          !isThinking &&
          !isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <div className="h-px flex-1 bg-border" />
              <span className="flex items-center gap-1">
                <span className="text-green-600">✓</span>
                Done
              </span>
              <div className="h-px flex-1 bg-border" />
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
}: {
  part: any;
  isStreaming?: boolean;
  isLast?: boolean;
}) {
  if (part.type === "reasoning") {
    // Determine active state: must be streaming AND be the last item
    const isActive = isStreaming && isLast;

    return (
      <ThinkingBlock
        text={part.text}
        isStreaming={isActive} // Only show spinner if active
        label="Thought"
      />
    );
  }
  if (part.type === "tool") {
    return (
      <div className="rounded-lg px-3 py-2 text-xs font-mono w-full max-w-md">
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
      <div className="rounded-lg px-4 py-2 w-full min-w-0 prose prose-sm dark:prose-invert max-w-none break-words overflow-x-hidden">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ node, className, ...props }) => (
              <pre
                {...props}
                className={`max-w-full overflow-x-auto whitespace-pre-wrap break-words ${
                  className ?? ""
                }`}
              />
            ),
          }}
        >
          {part.text}
        </ReactMarkdown>
      </div>
    );
  }
  return null;
}

function ThinkingBlock({
  text,
  isStreaming = false,
  label = "Thought",
}: {
  text: string;
  isStreaming?: boolean;
  label?: string;
}) {
  const [isOpen, setIsOpen] = useState(isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync open state with streaming state
  useEffect(() => {
    setIsOpen(isStreaming);
  }, [isStreaming]);

  // Auto-scroll to bottom when text changes (smooth scroll)
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [text, isOpen]);

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
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isOpen
            ? "max-h-52 opacity-100 translate-y-0"
            : "max-h-0 opacity-0 -translate-y-1"
        }`}
      >
        <div
          ref={scrollRef}
          className="mt-1 ml-1 pl-3 border border-muted rounded-md text-muted-foreground text-sm whitespace-pre-wrap py-2 px-3 h-40 overflow-y-auto bg-muted/30"
        >
          {text?.trim() || "..."}
        </div>
      </div>
    </div>
  );
}

// Animated status indicator with cycling dots
function StatusIndicator({
  isWaiting,
  streamingParts,
}: {
  isWaiting: boolean;
  streamingParts?: any[];
}) {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev % 3) + 1);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  // Determine label based on what we're streaming
  let label = "Waiting";
  if (!isWaiting) {
    // Check if the last streaming part is a reasoning/thought
    const lastPart = streamingParts?.[streamingParts.length - 1];
    label = lastPart?.type === "reasoning" ? "Thinking" : "Generating";
  }

  return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium py-1 px-1">
      <span>
        {label}
        {".".repeat(dots)}
      </span>
    </div>
  );
}
