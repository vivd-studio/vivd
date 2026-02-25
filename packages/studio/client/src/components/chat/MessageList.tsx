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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  buildChatTimelineModel,
  mergeLiveParts,
  type ChatTimelineItem,
} from "./chatTimelineBuilder";
import { shouldSuggestInterruptedContinue } from "./chatMessageUtils";

const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 80;

export function MessageList() {
  const {
    messages,
    selectedSessionId,
    isThinking,
    isWaiting,
    isLoading,
    isSessionHydrating,
    handleRevert,
    handleUnrevert,
    isReverted,
    streamingParts,
    setInput,
    handleContinueSession,
    sessionError,
    clearSessionError,
    sessionDebugState,
    usageLimitStatus,
    isUsageBlocked,
  } = useChatContext();

  const [dismissedWarnings, setDismissedWarnings] = useState(false);
  const [showRevertNotice, setShowRevertNotice] = useState(false);
  const [liveParts, setLiveParts] = useState<any[]>([]);
  const [workedOpenRunIds, setWorkedOpenRunIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [workedAutoCollapsedRunIds, setWorkedAutoCollapsedRunIds] = useState<Set<string>>(
    () => new Set(),
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const partOrderRef = useRef<Map<string, number>>(new Map());
  const nextPartOrderRef = useRef(0);
  const runStatusRef = useRef<Map<string, "in-progress" | "completed" | "other">>(
    new Map(),
  );
  const runSeenInProgressRef = useRef<Set<string>>(new Set());
  const workedCollapseTimersRef = useRef<Map<string, number>>(new Map());
  const workedAutoCollapsedRunIdsRef = useRef<Set<string>>(new Set());
  const stickToBottomRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollReleaseRef = useRef<number | null>(null);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior>("auto");
  const WORKED_AUTO_COLLAPSE_DELAY_MS = 1200;

  const isRunInProgress = isThinking || isLoading;

  const getScrollViewport = (): HTMLDivElement | null =>
    scrollRef.current?.querySelector<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]",
    ) ?? null;

  const scheduleScrollToBottom = (behavior: ScrollBehavior) => {
    pendingScrollBehaviorRef.current =
      behavior === "smooth" || pendingScrollBehaviorRef.current === "smooth"
        ? "smooth"
        : "auto";

    if (autoScrollFrameRef.current != null) return;

    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      const viewport = getScrollViewport();
      if (!viewport) return;

      isProgrammaticScrollRef.current = true;
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: pendingScrollBehaviorRef.current,
      });
      pendingScrollBehaviorRef.current = "auto";

      if (autoScrollReleaseRef.current != null) {
        window.clearTimeout(autoScrollReleaseRef.current);
      }
      autoScrollReleaseRef.current = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        autoScrollReleaseRef.current = null;

        const distanceFromBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        stickToBottomRef.current =
          distanceFromBottom <= CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
      }, 220);
    });
  };

  useEffect(() => {
    workedAutoCollapsedRunIdsRef.current = workedAutoCollapsedRunIds;
  }, [workedAutoCollapsedRunIds]);

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

  useEffect(
    () => () => {
      workedCollapseTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      workedCollapseTimersRef.current.clear();
      if (autoScrollFrameRef.current != null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
      }
      if (autoScrollReleaseRef.current != null) {
        window.clearTimeout(autoScrollReleaseRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    partOrderRef.current.clear();
    nextPartOrderRef.current = 0;
    runStatusRef.current.clear();
    runSeenInProgressRef.current.clear();
    workedCollapseTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    workedCollapseTimersRef.current.clear();
    setLiveParts([]);
    setWorkedOpenRunIds(new Set());
    setWorkedAutoCollapsedRunIds(new Set());
  }, [selectedSessionId]);

  useEffect(() => {
    let frameId: number | null = null;
    let viewport: HTMLDivElement | null = null;
    let handleScroll: (() => void) | null = null;

    const bindViewport = () => {
      viewport = getScrollViewport();
      if (!viewport) {
        frameId = window.requestAnimationFrame(bindViewport);
        return;
      }

      handleScroll = () => {
        if (isProgrammaticScrollRef.current || !viewport) return;
        const distanceFromBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        stickToBottomRef.current =
          distanceFromBottom <= CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
      };

      handleScroll();
      viewport.addEventListener("scroll", handleScroll, { passive: true });
    };

    bindViewport();

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      if (viewport && handleScroll) {
        viewport.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    if (
      messages.length > 0 ||
      isRunInProgress ||
      (streamingParts && streamingParts.length > 0)
    ) {
      if (!stickToBottomRef.current) return;
      scheduleScrollToBottom(isRunInProgress ? "smooth" : "auto");
    }
  }, [messages, isRunInProgress, streamingParts]);

  useEffect(() => {
    if (!streamingParts || streamingParts.length === 0) return;
    for (const part of streamingParts) {
      const partId = part?.id;
      if (!partId || partOrderRef.current.has(partId)) continue;
      partOrderRef.current.set(partId, nextPartOrderRef.current);
      nextPartOrderRef.current += 1;
    }
  }, [streamingParts]);

  useEffect(() => {
    for (const message of messages) {
      if (!message.parts || message.parts.length === 0) continue;
      for (const part of message.parts) {
        const partId = part?.id;
        if (!partId || partOrderRef.current.has(partId)) continue;
        partOrderRef.current.set(partId, nextPartOrderRef.current);
        nextPartOrderRef.current += 1;
      }
    }
  }, [messages]);

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
    if (!isRunInProgress) {
      if (liveParts.length > 0) {
        setLiveParts([]);
      }
      return;
    }

    const incomingParts = orderPartsBySeenSequence(streamingParts).filter(
      (part: any) =>
        part?.type === "reasoning" || part?.type === "tool" || part?.type === "text",
    );
    if (incomingParts.length === 0) return;

    setLiveParts((prev) => mergeLiveParts(prev, incomingParts));
  }, [streamingParts, isRunInProgress, liveParts.length]);

  const orderedLiveParts = useMemo(
    () => orderPartsBySeenSequence(liveParts),
    [liveParts],
  );

  const timeline = useMemo(
    () =>
      buildChatTimelineModel({
        messages,
        liveParts: orderedLiveParts,
        isWorking: isRunInProgress,
        isWaiting,
      }),
    [messages, orderedLiveParts, isRunInProgress, isWaiting],
  );

  useEffect(() => {
    const nextStatusMap = new Map<string, "in-progress" | "completed" | "other">();
    const newlyCompletedRunIds: string[] = [];

    for (const item of timeline.items) {
      if (item.kind !== "agent") continue;
      const nextStatus: "in-progress" | "completed" | "other" = item.runInProgress
        ? "in-progress"
        : item.showWorkedSection
          ? "completed"
          : "other";

      nextStatusMap.set(item.runId, nextStatus);
      const previousStatus = runStatusRef.current.get(item.runId);

      if (nextStatus === "in-progress") {
        runSeenInProgressRef.current.add(item.runId);
      }

      const hasBeenActive = runSeenInProgressRef.current.has(item.runId);
      if (
        nextStatus === "completed" &&
        previousStatus !== "completed" &&
        hasBeenActive
      ) {
        newlyCompletedRunIds.push(item.runId);
      }
    }

    runStatusRef.current = nextStatusMap;

    const activeRunIds = new Set(nextStatusMap.keys());
    runSeenInProgressRef.current = new Set(
      [...runSeenInProgressRef.current].filter((runId) => activeRunIds.has(runId)),
    );

    setWorkedOpenRunIds((prev) => {
      const next = new Set([...prev].filter((runId) => activeRunIds.has(runId)));
      let changed = next.size !== prev.size;
      for (const runId of newlyCompletedRunIds) {
        if (!next.has(runId)) {
          next.add(runId);
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    setWorkedAutoCollapsedRunIds((prev) => {
      const next = new Set([...prev].filter((runId) => activeRunIds.has(runId)));
      return next.size === prev.size ? prev : next;
    });

    workedCollapseTimersRef.current.forEach((timerId, runId) => {
      if (activeRunIds.has(runId)) return;
      window.clearTimeout(timerId);
      workedCollapseTimersRef.current.delete(runId);
    });

    for (const runId of newlyCompletedRunIds) {
      if (
        workedCollapseTimersRef.current.has(runId) ||
        workedAutoCollapsedRunIdsRef.current.has(runId)
      ) {
        continue;
      }

      const timerId = window.setTimeout(() => {
        workedCollapseTimersRef.current.delete(runId);
        setWorkedOpenRunIds((prev) => {
          if (!prev.has(runId)) return prev;
          const next = new Set(prev);
          next.delete(runId);
          return next;
        });
        setWorkedAutoCollapsedRunIds((prev) => {
          if (prev.has(runId)) return prev;
          const next = new Set(prev);
          next.add(runId);
          return next;
        });
      }, WORKED_AUTO_COLLAPSE_DELAY_MS);

      workedCollapseTimersRef.current.set(runId, timerId);
    }
  }, [timeline.items, isRunInProgress]);

  const onSuggestionClick = (suggestion: string) => setInput(suggestion);
  const shouldShowInterruptedContinue = shouldSuggestInterruptedContinue({
    sessionStatus: sessionDebugState.sessionStatus,
    messages,
    isThinking,
    isLoading,
  });

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="flex flex-col gap-2 px-4 pt-4 pb-16 md:px-6 md:pt-5 md:pb-20">
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
                onClick={() => setShowRevertNotice(false)}
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

        {timeline.items.map((item) =>
          item.kind === "user" ? (
            <UserMessageRow
              key={item.key}
              message={item.message}
              onRevert={handleRevert}
            />
          ) : (
            <AgentMessageRow
              key={item.key}
              item={item}
              orderedParts={
                item.runInProgress
                  ? orderPartsBySeenSequence(item.orderedParts)
                  : item.orderedParts
              }
              workedOpen={workedOpenRunIds.has(item.runId)}
              onToggleWorked={() =>
                setWorkedOpenRunIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.runId)) {
                    next.delete(item.runId);
                  } else {
                    next.add(item.runId);
                  }
                  return next;
                })
              }
            />
          ),
        )}

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

        {shouldShowInterruptedContinue && (
          <div className="flex justify-center py-1">
            <button
              type="button"
              onClick={handleContinueSession}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Agent interrupted, click to continue
            </button>
          </div>
        )}

        {!shouldShowInterruptedContinue &&
          messages.length > 0 &&
          messages[messages.length - 1].role === "agent" &&
          !isThinking &&
          !isLoading && (
            <SessionDivider label="Done" className="mb-0" />
          )}

        <div ref={bottomRef} className="h-px" />
      </div>
    </ScrollArea>
  );
}

function UserMessageRow({
  message,
  onRevert,
}: {
  message: Extract<ChatTimelineItem, { kind: "user" }>["message"];
  onRevert: (messageId: string) => void;
}) {
  const { cleanMessage, internalTags } = parseVivdInternalTags(message.content);
  const imageTags = internalTags.filter((tag) => tag.type === "dropped-file");
  const fileTags = internalTags.filter((tag) => tag.type === "attached-file");
  const elementTag = internalTags.find((tag) => tag.type === "element-ref");
  const hasElementRef =
    Boolean(elementTag?.selector) || Boolean(elementTag?.["source-file"]);

  return (
    <div className="flex flex-col gap-1 items-end chat-row-enter">
      <div className="h-6 flex items-center justify-end">
        {message.id ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] text-muted-foreground/75 hover:text-muted-foreground h-6 px-2"
            onClick={() => onRevert(message.id!)}
          >
            <Undo2 className="w-3 h-3 mr-1" />
            Revert to here
          </Button>
        ) : (
          <span aria-hidden="true" className="h-6 w-px opacity-0" />
        )}
      </div>

      <div className="max-w-[90%] min-w-0">
        <div className="rounded-lg px-4 pt-2 pb-2.5 overflow-x-hidden bg-muted dark:bg-muted/20 text-foreground text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={getChatMarkdownComponents({ compactParagraphs: true })}
          >
            {cleanMessage}
          </ReactMarkdown>

          {(imageTags.length > 0 || fileTags.length > 0 || hasElementRef) && (
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
        {message.createdAt && (
          <div className="mt-0.5 px-1 text-[10px] text-muted-foreground/60 text-right">
            {formatMessageTime(message.createdAt)}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentMessageRow({
  item,
  orderedParts,
  workedOpen,
  onToggleWorked,
}: {
  item: Extract<ChatTimelineItem, { kind: "agent" }>;
  orderedParts: any[];
  workedOpen: boolean;
  onToggleWorked: () => void;
}) {
  const orderedActionParts = orderedParts.filter(
    (part) => part?.type === "reasoning" || part?.type === "tool",
  );
  const orderedResponseParts = orderedParts.filter(
    (part) => part?.type === "text",
  );
  const hasLegacyContent =
    item.message &&
    (!item.message.parts || item.message.parts.length === 0) &&
    item.message.content;
  const lastOrderedActionPart = orderedActionParts[orderedActionParts.length - 1];
  const hasActiveOrderedAction =
    Boolean(lastOrderedActionPart) &&
    (lastOrderedActionPart?.type === "reasoning" ||
      normalizeToolStatus(lastOrderedActionPart) === "running");

  return (
    <div className="flex flex-col gap-1 w-full items-start overflow-hidden chat-row-enter">
      {item.showWorkedSection ? (
        <WorkedSessionSection
          label={item.workedLabel ?? "Worked session"}
          isOpen={workedOpen}
          onToggle={onToggleWorked}
        >
          {orderedActionParts.map((part, index) => (
            <MessagePartBubble
              key={part?.id ?? `worked-action-${index}`}
              part={part}
              isStreaming={false}
              isLast={index === orderedActionParts.length - 1}
            />
          ))}
        </WorkedSessionSection>
      ) : (
        <>
          {orderedParts.map((part, index) => (
            <MessagePartBubble
              key={part?.id ?? `live-part-${index}`}
              part={part}
              isStreaming={item.runInProgress}
              isLast={index === orderedParts.length - 1}
            />
          ))}
          {item.runInProgress && item.fallbackState && !hasActiveOrderedAction && (
            <AgentStateRow
              label={
                <LoadingStateLabel
                  prefix={
                    <span className="font-semibold">
                      {item.fallbackState === "waiting" ? "Waiting" : "Working"}
                    </span>
                  }
                />
              }
              tone="muted"
            />
          )}
        </>
      )}

      {item.showWorkedSection &&
        orderedResponseParts.map((part, index) => (
          <MessagePartBubble
            key={part?.id ?? `response-${index}`}
            part={part}
            isStreaming={item.runInProgress}
            isLast={index === orderedResponseParts.length - 1}
          />
        ))}

      {hasLegacyContent && (
        <AgentMarkdownBlock
          text={item.message?.content ?? ""}
          isStreaming={item.runInProgress}
        />
      )}
    </div>
  );
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function WorkedSessionSection({
  label,
  children,
  isOpen,
  onToggle,
}: {
  label: string;
  children: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-full">
      <SessionDivider
        label={label}
        onClick={onToggle}
        icon={
          isOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )
        }
        className="text-muted-foreground/80 hover:text-muted-foreground"
      />
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? "max-h-[30rem] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="max-h-[28rem] overflow-y-auto py-1.5 pr-1">
          <div className="flex flex-col gap-0.5">{children}</div>
        </div>
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
        className={`w-full flex items-center gap-3 my-4 py-1 text-xs transition-colors ${className}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`w-full flex items-center gap-3 my-4 py-1 text-xs text-muted-foreground ${className}`}
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

    const isActive = isStreaming && isLast;

    return (
      <AgentActivityRow
        label={
          isActive ? (
            <LoadingStateLabel
              prefix={<span className="font-bold">Thinking</span>}
            />
          ) : (
            <span className="font-semibold">Thought</span>
          )
        }
        tone="muted"
        renderContent={(isOpen) => <ThoughtContent text={thoughtText} isOpen={isOpen} />}
      />
    );
  }

  if (part.type === "tool") {
    const toolStatus = normalizeToolStatus(part) ?? "completed";
    const toolLabelParts = getToolActivityLabelParts(part);
    const toolInput = summarizeToolInput(part.input);
    const toolDescription =
      toolStatus === "error" ? undefined : extractToolDescription(part.input);
    const isRunning = toolStatus === "running";
    const actionText = isRunning
      ? stripTrailingDots(toolLabelParts.action)
      : toolLabelParts.action;
    const targetText = isRunning
      ? stripTrailingDots(toolLabelParts.target)
      : toolLabelParts.target;
    const toolActionLabel = (
      <span className="inline-flex shrink-0 items-baseline gap-1">
        <span className="font-bold">{actionText}</span>
        {targetText && <span className="font-normal">{targetText}</span>}
      </span>
    );

    return (
      <AgentActivityRow
        label={
          isRunning ? (
            <LoadingStateLabel prefix={toolActionLabel} />
          ) : (
            <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 whitespace-nowrap">
              {toolActionLabel}
              {toolDescription && (
                <span
                  className="min-w-0 truncate text-muted-foreground/70 font-normal"
                  title={toolDescription}
                >
                  {toolDescription}
                </span>
              )}
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
      <AgentMarkdownBlock text={part.text ?? ""} isStreaming={isStreaming && isLast} />
    );
  }

  return null;
}

function AgentMarkdownBlock({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const [animateChunk, setAnimateChunk] = useState(false);
  const previousTextRef = useRef(text);

  useEffect(() => {
    if (!isStreaming) {
      previousTextRef.current = text;
      setAnimateChunk(false);
      return;
    }
    if (text === previousTextRef.current) return;

    previousTextRef.current = text;
    setAnimateChunk(true);
    const timer = window.setTimeout(() => setAnimateChunk(false), 180);
    return () => window.clearTimeout(timer);
  }, [text, isStreaming]);

  return (
    <div
      className={`rounded-lg px-3 py-1.5 w-full min-w-0 text-sm leading-relaxed max-w-none break-words overflow-x-hidden ${
        animateChunk ? "chat-stream-chunk-fade" : ""
      }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={getChatMarkdownComponents()}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function stripTrailingDots(value?: string): string | undefined {
  if (!value) return value;
  return value.replace(/\.+\s*$/, "");
}

function ThoughtContent({ text, isOpen }: { text: string; isOpen: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [text, isOpen]);

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

function parseToolObjectInput(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid JSON input.
  }
  return null;
}

function extractToolDescription(input: unknown): string | undefined {
  const obj = parseToolObjectInput(input);
  if (!obj) return undefined;

  const description = obj.description;
  if (typeof description !== "string") return undefined;

  const normalized = description.replace(/\s+/g, " ").trim();
  return normalized || undefined;
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
      <div className={`text-xs font-medium py-0.5 px-1 leading-5 ${toneClass}`}>
        <span className="inline-flex items-center gap-1">{label}</span>
      </div>
    </div>
  );
}

function AgentActivityRow({
  label,
  children,
  renderContent,
  defaultOpen = false,
  tone = "muted",
}: {
  label: ReactNode;
  children?: ReactNode;
  renderContent?: (isOpen: boolean) => ReactNode;
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
        <span className={`flex items-center gap-1 ${toneClass}`}>
          <span className="min-w-0 flex-1">{label}</span>
          <span className="inline-flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">
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
        {isOpen && (
          <div className="mt-0.5 ml-1 pl-2 pr-1 pb-1 border-l border-border/60 text-xs text-muted-foreground">
            {renderContent ? renderContent(isOpen) : children}
          </div>
        )}
      </div>
    </div>
  );
}

function getChatMarkdownComponents({
  compactParagraphs = false,
}: {
  compactParagraphs?: boolean;
} = {}) {
  const paragraphClass = compactParagraphs
    ? "mb-0 last:mb-0 break-words"
    : "mb-3 last:mb-0 break-words";
  const listClass = compactParagraphs
    ? "my-1 pl-5 space-y-0.5"
    : "my-2 pl-5 space-y-1";
  const headingClass =
    "text-sm leading-relaxed font-semibold mb-2 mt-3 first:mt-0";

  return {
    p: ({ children }: any) => <p className={paragraphClass}>{children}</p>,
    h1: ({ children }: any) => <h1 className={headingClass}>{children}</h1>,
    h2: ({ children }: any) => <h2 className={headingClass}>{children}</h2>,
    h3: ({ children }: any) => <h3 className={headingClass}>{children}</h3>,
    h4: ({ children }: any) => <h4 className={headingClass}>{children}</h4>,
    h5: ({ children }: any) => <h5 className={headingClass}>{children}</h5>,
    h6: ({ children }: any) => <h6 className={headingClass}>{children}</h6>,
    ul: ({ children }: any) => <ul className={`${listClass} list-disc`}>{children}</ul>,
    ol: ({ children }: any) => (
      <ol className={`${listClass} list-decimal`}>{children}</ol>
    ),
    li: ({ children }: any) => <li className="break-words">{children}</li>,
    a: ({ children, href }: any) => (
      <a
        href={href}
        className="text-primary underline underline-offset-2 break-all"
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    ),
    code: ({ inline, children }: any) =>
      inline ? (
        <code className="rounded bg-muted/50 px-1 py-0.5 text-[0.92em] break-words">
          {children}
        </code>
      ) : (
        <code className="text-xs leading-relaxed">{children}</code>
      ),
    pre: ({ children }: any) => (
      <pre className="my-2 overflow-x-auto rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed">
        {children}
      </pre>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="my-2 border-l-2 border-border/70 pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
  };
}
