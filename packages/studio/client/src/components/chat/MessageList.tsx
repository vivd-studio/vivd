import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/common";
import {
  ChevronRight,
  ChevronDown,
  Undo2,
  AlertTriangle,
  AlertCircle,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  getToolActivityLabelParts,
  sanitizeThoughtText,
  normalizeToolStatus,
} from "./chatStreamUtils";

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
  const [showRevertNotice, setShowRevertNotice] = useState(false);
  const [liveActionParts, setLiveActionParts] = useState<any[]>([]);

  useEffect(() => {
    try {
      const key = "vivd_chat_revert_notice_seen_v1";
      if (window.localStorage.getItem(key) !== "1") {
        setShowRevertNotice(true);
        window.localStorage.setItem(key, "1");
      }
    } catch {
      // Ignore storage access issues.
    }
  }, []);

  const dismissRevertNotice = () => {
    setShowRevertNotice(false);
  };

  const onSuggestionClick = (suggestion: string) => setInput(suggestion);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const partOrderRef = useRef<Map<string, number>>(new Map());
  const nextPartOrderRef = useRef(0);

  useEffect(() => {
    // Only scroll when there are messages - don't scroll on empty session
    if (
      messages.length > 0 ||
      isThinking ||
      (streamingParts && streamingParts.length > 0)
    ) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages, isThinking, streamingParts]);

  useEffect(() => {
    if (!streamingParts || streamingParts.length === 0) return;
    for (const part of streamingParts) {
      const partId = part?.id;
      if (!partId || partOrderRef.current.has(partId)) continue;
      partOrderRef.current.set(partId, nextPartOrderRef.current);
      nextPartOrderRef.current += 1;
    }
  }, [streamingParts]);

  const orderPartsBySeenSequence = (parts: any[] | undefined): any[] => {
    if (!parts || parts.length < 2) return parts ?? [];

    return [...parts].sort((a, b) => {
      const aId = typeof a?.id === "string" ? a.id : undefined;
      const bId = typeof b?.id === "string" ? b.id : undefined;
      const aOrder =
        aId && partOrderRef.current.has(aId)
          ? partOrderRef.current.get(aId)!
          : Number.MAX_SAFE_INTEGER;
      const bOrder =
        bId && partOrderRef.current.has(bId)
          ? partOrderRef.current.get(bId)!
          : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder;
    });
  };

  useEffect(() => {
    if (!isThinking && !isLoading && !isWaiting) {
      if (liveActionParts.length > 0) {
        setLiveActionParts([]);
      }
      return;
    }

    const incomingActionParts = orderPartsBySeenSequence(streamingParts).filter(
      (part: any) => part?.type === "reasoning" || part?.type === "tool",
    );
    if (incomingActionParts.length === 0) return;

    setLiveActionParts((prev) => mergeLiveActionParts(prev, incomingActionParts));
  }, [streamingParts, isThinking, isLoading, isWaiting]);

  const previousUserTimestampByMessageIndex = new Map<number, number | undefined>();
  let mostRecentUserTimestamp: number | undefined;
  for (let index = 0; index < messages.length; index += 1) {
    previousUserTimestampByMessageIndex.set(index, mostRecentUserTimestamp);
    const message = messages[index];
    if (message.role === "user" && message.createdAt) {
      mostRecentUserTimestamp = message.createdAt;
    }
  }

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="flex flex-col gap-2 px-3 py-3 md:px-5 md:py-4">
        {showRevertNotice && (
          <div className="flex justify-center">
            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 max-w-[90%] w-full">
              <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  Chat revert is best-effort. For safer rollback, create snapshots in Version History.
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 h-6 w-6 p-0"
                onClick={dismissRevertNotice}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
        {messages.length === 0 &&
          (isSessionHydrating ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <LoadingSpinner message="Loading session..." />
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
          if (
            isLastMessage &&
            msg.role === "agent" &&
            (isStreaming || isWaiting || isLoading)
          ) {
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
          const previousUserTimestamp = previousUserTimestampByMessageIndex.get(i);

          return (
            <div
              key={i}
              className={`flex flex-col gap-1 ${
                isUser ? "items-end" : "items-start w-full"
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
                    <div className="max-w-[90%] min-w-0">
                      <div className="rounded-lg px-3 py-1.5 overflow-x-hidden bg-muted dark:bg-muted/45 text-foreground">
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
                          <div className="mt-1.5 pt-1.5 border-t border-foreground/10 flex flex-wrap gap-1">
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
                      {msg.createdAt && (
                        <div className="mt-0.5 px-1 text-[10px] text-muted-foreground/60 text-right">
                          {formatMessageTime(msg.createdAt)}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                /* Agent Message Construction - Split into parts */
                <div className="flex flex-col gap-1 w-full items-start overflow-hidden">
                  {msg.parts && msg.parts.length > 0 ? (
                    (() => {
                      const orderedParts = orderPartsBySeenSequence(msg.parts);
                      const actionParts = orderedParts.filter(
                        (part: any) =>
                          part?.type === "reasoning" || part?.type === "tool",
                      );
                      const responseParts = orderedParts.filter(
                        (part: any) => part?.type === "text",
                      );
                      const isRunInProgress =
                        isLastMessage && (isStreaming || isWaiting || isLoading);
                      const shouldShowWorkedSection =
                        actionParts.length > 0 && responseParts.length > 0;

                      return (
                        <>
                          {shouldShowWorkedSection && (
                            <WorkedSessionSection
                              label={formatWorkedLabel(
                                previousUserTimestamp,
                                msg.createdAt,
                              )}
                              defaultOpen={isRunInProgress}
                            >
                              {actionParts.map((part: any, pIndex: number) => (
                                <MessagePartBubble
                                  key={part?.id ?? `action-${pIndex}`}
                                  part={part}
                                  isStreaming={isRunInProgress}
                                />
                              ))}
                            </WorkedSessionSection>
                          )}
                          {!shouldShowWorkedSection &&
                            actionParts.map((part: any, pIndex: number) => (
                              <MessagePartBubble
                                key={part?.id ?? `action-${pIndex}`}
                                part={part}
                                isStreaming={isRunInProgress}
                              />
                            ))}
                          {responseParts.map((part: any, pIndex: number) => (
                            <MessagePartBubble
                              key={part?.id ?? `response-${pIndex}`}
                              part={part}
                            />
                          ))}
                        </>
                      );
                    })()
                  ) : (
                    /* Fallback for legacy messages */
                    <div className="rounded-lg px-3 py-1.5 w-full min-w-0 prose prose-sm dark:prose-invert max-w-none break-words overflow-x-hidden">
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
          <div className="flex justify-start w-full">
            <div className="flex flex-col gap-1 w-full items-start">
              {/* Streaming Parts */}
              {(() => {
                const displayStreamingActionParts = liveActionParts;
                const lastStreamingActionPart =
                  displayStreamingActionParts[displayStreamingActionParts.length - 1];
                const hasActiveStreamingState =
                  Boolean(lastStreamingActionPart) &&
                  (lastStreamingActionPart.type === "reasoning" ||
                    normalizeToolStatus(lastStreamingActionPart) === "running");
                const showWorkingFallback =
                  displayStreamingActionParts.length > 0 && !hasActiveStreamingState;

                return (
                  <>
                    {displayStreamingActionParts.map((part, idx) => {
                      const isLast = idx === displayStreamingActionParts.length - 1;
                      return (
                        <MessagePartBubble
                          key={part?.id ?? `streaming-part-${idx}`}
                          part={part}
                          isStreaming={true}
                          isLast={isLast}
                        />
                      );
                    })}
                    {showWorkingFallback && (
                      <AgentStateRow
                        label={
                          <LoadingStateLabel
                            prefix={<span className="font-semibold">Working</span>}
                          />
                        }
                        tone="muted"
                      />
                    )}
                    {displayStreamingActionParts.length === 0 && isWaiting && (
                      <AgentStateRow
                        label={
                          <LoadingStateLabel
                            prefix={<span className="font-semibold">Waiting</span>}
                          />
                        }
                        tone="muted"
                      />
                    )}
                  </>
                );
              })()}
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
                  {sessionError.type === "retry" ||
                  sessionError.type === "provider_limit" ||
                  sessionError.type === "stream"
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
          <div className="flex justify-center py-2">
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
            <SessionDivider label="Done" />
          )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWorkedLabel(
  startedAt?: number,
  completedAt?: number,
): string {
  if (!startedAt || !completedAt || completedAt <= startedAt) {
    return "Worked session";
  }

  const durationSec = Math.max(1, Math.round((completedAt - startedAt) / 1000));
  if (durationSec < 60) {
    return `Worked for ${durationSec}s`;
  }

  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  if (seconds === 0) {
    return `Worked for ${minutes}m`;
  }
  return `Worked for ${minutes}m ${seconds}s`;
}

function WorkedSessionSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <div className="w-full">
      <SessionDivider
        label={label}
        onClick={() => setIsOpen((prev) => !prev)}
        icon={isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        className="text-muted-foreground/80 hover:text-muted-foreground"
      />
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isOpen ? "max-h-[30rem] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="mt-0.5 flex flex-col gap-0.5">{children}</div>
      </div>
    </div>
  );
}

function SessionDivider({
  label,
  icon,
  onClick,
  className = "",
}: {
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      <span className="h-px flex-1 bg-border/70" />
      <span className="inline-flex items-center gap-1 shrink-0">
        <span>{label}</span>
        {icon}
      </span>
      <span className="h-px flex-1 bg-border/70" />
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-3 my-3 py-0.5 text-xs transition-colors ${className}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`w-full flex items-center gap-3 my-3 py-0.5 text-xs text-muted-foreground ${className}`}
    >
      {content}
    </div>
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
    const thoughtText = sanitizeThoughtText(part.text ?? "");
    if (!thoughtText.trim()) {
      return null;
    }

    // Determine active state: must be streaming AND be the last item
    const isActive = isStreaming && isLast;

    return (
      <AgentActivityRow
        label={
          isActive ? (
            <LoadingStateLabel
              prefix={<span className="font-semibold">Thinking</span>}
            />
          ) : (
            <span className="font-semibold">Thought</span>
          )
        }
        tone="muted"
      >
        <ThoughtContent text={thoughtText} />
      </AgentActivityRow>
    );
  }
  if (part.type === "tool") {
    const toolStatus = normalizeToolStatus(part) ?? "completed";
    const toolLabelParts = getToolActivityLabelParts(part);
    const toolInput = summarizeToolInput(part.input);
    const isRunning = toolStatus === "running";
    const actionText = isRunning
      ? stripTrailingDots(toolLabelParts.action)
      : toolLabelParts.action;
    const targetText = isRunning
      ? stripTrailingDots(toolLabelParts.target)
      : toolLabelParts.target;

    return (
      <AgentActivityRow
        label={
          isRunning ? (
            <LoadingStateLabel
              prefix={
                <span className="inline-flex items-baseline gap-1">
                  <span className="font-semibold">{actionText}</span>
                  {targetText && <span>{targetText}</span>}
                </span>
              }
            />
          ) : (
            <span className="inline-flex items-baseline gap-1">
              <span className="font-semibold">{actionText}</span>
              {targetText && <span>{targetText}</span>}
            </span>
          )
        }
        tone={toolStatus === "error" ? "destructive" : "muted"}
      >
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground/90">
            Tool: <span className="font-mono">{String(part.tool ?? "unknown")}</span>
          </div>
          {part.title && (
            <div className="text-[11px] text-muted-foreground/90 whitespace-pre-wrap break-words">
              {String(part.title)}
            </div>
          )}
          {toolInput && (
            <pre className="text-[11px] text-muted-foreground/90 bg-muted/40 rounded px-2 py-1 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
              {toolInput}
            </pre>
          )}
          {toolStatus === "error" && (
            <div className="text-[11px] text-destructive/90">
              Action failed. Technical error details are hidden.
            </div>
          )}
        </div>
      </AgentActivityRow>
    );
  }
  if (part.type === "text") {
    return (
      <div className="rounded-lg px-3 py-1.5 w-full min-w-0 prose prose-sm dark:prose-invert max-w-none break-words overflow-x-hidden">
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

function mergeLiveActionParts(prev: any[], incoming: any[]): any[] {
  const next = [...prev];
  const indexById = new Map<string, number>();

  next.forEach((part, index) => {
    if (part?.id) {
      indexById.set(String(part.id), index);
    }
  });

  for (const part of incoming) {
    const partId = part?.id ? String(part.id) : undefined;
    if (partId && indexById.has(partId)) {
      const existingIndex = indexById.get(partId)!;
      next[existingIndex] = { ...next[existingIndex], ...part };
      continue;
    }

    if (partId) {
      indexById.set(partId, next.length);
      next.push(part);
      continue;
    }

    const existingAnonIndex = next.findIndex(
      (candidate) =>
        !candidate?.id &&
        candidate?.type === part?.type &&
        candidate?.tool === part?.tool &&
        candidate?.title === part?.title,
    );

    if (existingAnonIndex >= 0) {
      next[existingAnonIndex] = { ...next[existingAnonIndex], ...part };
      continue;
    }

    next.push(part);
  }

  return next;
}

function stripTrailingDots(value?: string): string | undefined {
  if (!value) return value;
  return value.replace(/\.+\s*$/, "");
}

function ThoughtContent({ text }: { text: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [text]);

  return (
    <div ref={scrollRef} className="max-h-32 overflow-y-auto whitespace-pre-wrap pr-1">
      {text}
    </div>
  );
}

function LoadingStateLabel({ prefix }: { prefix: ReactNode }) {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1);
    }, 420);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="inline-flex items-baseline gap-0.5 chat-loading-wave">
      <span>{prefix}</span>
      <span>{".".repeat(dotCount)}</span>
    </span>
  );
}

function summarizeToolInput(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}\n...` : trimmed;
  }
  try {
    const serialized = JSON.stringify(input, null, 2);
    if (!serialized || serialized === "{}") return null;
    return serialized.length > 500
      ? `${serialized.slice(0, 500)}\n...`
      : serialized;
  } catch {
    return null;
  }
}

function AgentStateRow({
  label,
  tone = "muted",
}: {
  label: ReactNode;
  tone?: "muted" | "destructive";
}) {
  const toneClass = tone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="w-full max-w-md">
      <div className={`text-xs font-medium py-0.5 px-1 ${toneClass}`}>
        {label}
      </div>
    </div>
  );
}

function AgentActivityRow({
  label,
  children,
  defaultOpen = false,
  tone = "muted",
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: "muted" | "destructive";
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  const toneClass = tone === "destructive" ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="w-full max-w-md">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group w-full text-left hover:text-foreground transition-colors text-xs font-medium py-0.5 px-1"
      >
        <span className={`inline-flex items-center gap-1 ${toneClass}`}>
          <span>{label}</span>
          <span className="inline-flex items-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">
            {isOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        </span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isOpen
            ? "max-h-64 opacity-100 translate-y-0"
            : "max-h-0 opacity-0 -translate-y-0.5"
        }`}
      >
        <div className="mt-0.5 ml-1 pl-2 pr-1 pb-1 border-l border-border/60 text-xs text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}
