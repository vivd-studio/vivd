import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/common";
import {
  ChevronRight,
  ChevronDown,
  Undo2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useOpencodeChat } from "@/features/opencodeChat";
import { cn } from "@/lib/utils";
import {
  buildCanonicalTimelineModel,
  shouldSuggestInterruptedContinueFromRecords,
  type CanonicalTimelineItem,
} from "@/features/opencodeChat/render/timeline";
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
  buildSessionErrorNotice,
  type SessionErrorNoticeContent,
} from "./sessionErrorNotice";

type ActiveTurnLayout = {
  messageId: string;
  bodyMinHeight: number;
};

type PendingAnchorRequest = {
  messageId: string;
  behavior: ScrollBehavior;
};

export function MessageList() {
  const {
    selectedSessionId,
    isThinking,
    isWaiting,
    isLoading,
    isSessionHydrating,
    handleRevert,
    handleUnrevert,
    isReverted,
    setInput,
    handleContinueSession,
    activeQuestionRequest,
    sessionError,
    clearSessionError,
    sessionDebugState,
    usageLimitStatus,
    isUsageBlocked,
    initialGenerationRequested,
    initialGenerationStarting,
    initialGenerationFailed,
    retryInitialGeneration,
  } = useChatContext();
  const opencodeChat = useOpencodeChat();
  const selectedMessages = opencodeChat.selectedMessages;

  const [dismissedWarnings, setDismissedWarnings] = useState(false);
  const [showRevertNotice, setShowRevertNotice] = useState(false);
  const [sessionErrorNow, setSessionErrorNow] = useState(() => Date.now());
  const [activeTurnLayout, setActiveTurnLayout] = useState<ActiveTurnLayout | null>(
    null,
  );
  const [pendingAnchorRequest, setPendingAnchorRequest] =
    useState<PendingAnchorRequest | null>(null);
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);
  const [workedOpenRunIds, setWorkedOpenRunIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [workedAutoCollapsedRunIds, setWorkedAutoCollapsedRunIds] = useState<Set<string>>(
    () => new Set(),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const runStatusRef = useRef<Map<string, "in-progress" | "completed" | "other">>(
    new Map(),
  );
  const runSeenInProgressRef = useRef<Set<string>>(new Set());
  const workedCollapseTimersRef = useRef<Map<string, number>>(new Map());
  const workedAutoCollapsedRunIdsRef = useRef<Set<string>>(new Set());
  const userMessageRefs = useRef(new Map<string, HTMLDivElement>());
  const userMessageRowRefs = useRef(new Map<string, HTMLDivElement>());
  const lastAnchoredUserMessageIdRef = useRef<string | null>(null);
  const pendingHydrationAnchorRef = useRef(true);
  const WORKED_AUTO_COLLAPSE_DELAY_MS = 1200;
  const CHAT_ANCHOR_TOP_INSET_PX = 40;
  const ACTIVE_TURN_BODY_GAP_PX = 8;

  const isRunInProgress = isThinking || isLoading;

  const getScrollViewport = (): HTMLDivElement | null => scrollRef.current;

  const getTranscriptBottomPaddingPx = useCallback(() => {
    const transcriptContent = transcriptContentRef.current;
    if (transcriptContent) {
      const paddingBottom = Number.parseFloat(
        window.getComputedStyle(transcriptContent).paddingBottom || "0",
      );
      if (Number.isFinite(paddingBottom) && paddingBottom > 0) {
        return paddingBottom;
      }
    }

    return window.innerWidth >= 768 ? 80 : 64;
  }, []);

  const setUserMessageRef = useCallback(
    (messageId: string, node: HTMLDivElement | null) => {
      if (!messageId) return;
      if (node) {
        userMessageRefs.current.set(messageId, node);
      } else {
        userMessageRefs.current.delete(messageId);
      }
    },
    [],
  );

  const setUserMessageRowRef = useCallback(
    (messageId: string, node: HTMLDivElement | null) => {
      if (!messageId) return;
      if (node) {
        userMessageRowRefs.current.set(messageId, node);
      } else {
        userMessageRowRefs.current.delete(messageId);
      }
    },
    [],
  );

  const syncScrollFades = useCallback(() => {
    const viewport = getScrollViewport();
    if (!viewport) {
      setShowTopFade(false);
      setShowBottomFade(false);
      return;
    }

    const nextTopFade = viewport.scrollTop > 6;
    const nextBottomFade =
      viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 6;

    setShowTopFade((prev) => (prev === nextTopFade ? prev : nextTopFade));
    setShowBottomFade((prev) =>
      prev === nextBottomFade ? prev : nextBottomFade,
    );
  }, []);

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

  useEffect(() => {
    return () => {
      workedCollapseTimersRef.current.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      workedCollapseTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    runStatusRef.current.clear();
    runSeenInProgressRef.current.clear();
    workedCollapseTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    workedCollapseTimersRef.current.clear();
    setWorkedOpenRunIds(new Set());
    setWorkedAutoCollapsedRunIds(new Set());
    pendingHydrationAnchorRef.current = true;
    lastAnchoredUserMessageIdRef.current = null;
    setActiveTurnLayout(null);
    setPendingAnchorRequest(null);
  }, [selectedSessionId]);

  useEffect(() => {
    if (
      sessionError?.type !== "retry" ||
      typeof sessionError.nextRetryAt !== "number"
    ) {
      return;
    }

    setSessionErrorNow(Date.now());
    const timer = window.setInterval(() => {
      setSessionErrorNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sessionError?.type, sessionError?.nextRetryAt]);

  const timeline = useMemo(
    () =>
      buildCanonicalTimelineModel({
        messages: selectedMessages,
        sessionStatus: opencodeChat.sessionStatus,
        isThinking: isRunInProgress,
        isWaiting,
      }),
    [selectedMessages, opencodeChat.sessionStatus, isRunInProgress, isWaiting],
  );

  const sessionErrorNotice = useMemo(
    () =>
      sessionError
        ? buildSessionErrorNotice(sessionError, sessionErrorNow)
        : null,
    [sessionError, sessionErrorNow],
  );

  const latestUserMessageId = useMemo(() => {
    for (let index = timeline.items.length - 1; index >= 0; index -= 1) {
      const item = timeline.items[index];
      if (item?.kind === "user" && item.message.id) {
        return item.message.id;
      }
    }
    return null;
  }, [timeline.items]);
  const latestUserItemIndex = useMemo(() => {
    for (let index = timeline.items.length - 1; index >= 0; index -= 1) {
      const item = timeline.items[index];
      if (item?.kind === "user" && item.message.id) {
        return index;
      }
    }
    return -1;
  }, [timeline.items]);
  const showEmptyState = selectedMessages.length === 0 && !isSessionHydrating;

  const historicalItems =
    latestUserItemIndex >= 0
      ? timeline.items.slice(0, latestUserItemIndex)
      : timeline.items;
  const activeTurnUserItem =
    latestUserItemIndex >= 0 && timeline.items[latestUserItemIndex]?.kind === "user"
      ? (timeline.items[latestUserItemIndex] as Extract<
          CanonicalTimelineItem,
          { kind: "user" }
        >)
      : null;
  const activeTurnAgentItems = activeTurnUserItem
    ? timeline.items.slice(latestUserItemIndex + 1)
    : [];

  useEffect(() => {
    if (isSessionHydrating || !latestUserMessageId) {
      return;
    }

    const shouldAnchor =
      pendingHydrationAnchorRef.current ||
      lastAnchoredUserMessageIdRef.current !== latestUserMessageId;

    if (!shouldAnchor) return;

    const scrollBehavior: ScrollBehavior = pendingHydrationAnchorRef.current
      ? "auto"
      : "smooth";
    pendingHydrationAnchorRef.current = false;
    setActiveTurnLayout({
      messageId: latestUserMessageId,
      bodyMinHeight: 0,
    });
    setPendingAnchorRequest({
      messageId: latestUserMessageId,
      behavior: scrollBehavior,
    });
  }, [isSessionHydrating, latestUserMessageId]);

  useEffect(() => {
    if (!latestUserMessageId) {
      setActiveTurnLayout(null);
      setPendingAnchorRequest(null);
    }
  }, [latestUserMessageId]);

  const computeActiveTurnBodyMinHeight = useCallback((messageId: string) => {
    const viewport = getScrollViewport();
    const anchorNode = userMessageRefs.current.get(messageId);
    const rowNode = userMessageRowRefs.current.get(messageId);

    if (!viewport || !anchorNode || !rowNode) {
      return null;
    }

    const anchorRect = anchorNode.getBoundingClientRect();
    const rowRect = rowNode.getBoundingClientRect();
    const contentBelowAnchorBeforeBody =
      rowRect.bottom - anchorRect.top + ACTIVE_TURN_BODY_GAP_PX;
    const transcriptBottomPaddingPx = getTranscriptBottomPaddingPx();

    return Math.max(
      0,
      Math.ceil(
        viewport.clientHeight -
          CHAT_ANCHOR_TOP_INSET_PX -
          contentBelowAnchorBeforeBody -
          transcriptBottomPaddingPx,
      ),
    );
  }, [getTranscriptBottomPaddingPx]);

  useLayoutEffect(() => {
    if (!pendingAnchorRequest || isSessionHydrating) {
      return;
    }

    const nextBodyMinHeight = computeActiveTurnBodyMinHeight(
      pendingAnchorRequest.messageId,
    );
    if (nextBodyMinHeight == null) {
      return;
    }

    if (
      activeTurnLayout?.messageId !== pendingAnchorRequest.messageId ||
      activeTurnLayout.bodyMinHeight !== nextBodyMinHeight
    ) {
      setActiveTurnLayout({
        messageId: pendingAnchorRequest.messageId,
        bodyMinHeight: nextBodyMinHeight,
      });
      return;
    }

    const viewport = getScrollViewport();
    if (!viewport) {
      return;
    }

    viewport.scrollTo({
      top: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      behavior: pendingAnchorRequest.behavior,
    });
    syncScrollFades();
    lastAnchoredUserMessageIdRef.current = pendingAnchorRequest.messageId;
    setPendingAnchorRequest(null);
  }, [
    activeTurnLayout,
    computeActiveTurnBodyMinHeight,
    isSessionHydrating,
    pendingAnchorRequest,
    syncScrollFades,
  ]);

  useEffect(() => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const handleScroll = () => {
      window.requestAnimationFrame(syncScrollFades);
    };

    syncScrollFades();
    viewport.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(syncScrollFades);
    });
    resizeObserver.observe(viewport);

    const viewportContent = viewport.firstElementChild;
    if (viewportContent instanceof HTMLElement) {
      resizeObserver.observe(viewportContent);
    }

    return () => {
      viewport.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [selectedSessionId, syncScrollFades]);

  useEffect(() => {
    if (!latestUserMessageId) {
      return;
    }

    const viewport = getScrollViewport();
    const anchorNode = userMessageRefs.current.get(latestUserMessageId);
    const rowNode = userMessageRowRefs.current.get(latestUserMessageId);

    if (!viewport || !anchorNode || !rowNode) {
      return;
    }

    const syncActiveTurnLayout = () => {
      const nextBodyMinHeight = computeActiveTurnBodyMinHeight(latestUserMessageId);
      if (nextBodyMinHeight == null) return;

      setActiveTurnLayout((prev) => {
        if (
          prev?.messageId === latestUserMessageId &&
          prev.bodyMinHeight === nextBodyMinHeight
        ) {
          return prev;
        }
        return {
          messageId: latestUserMessageId,
          bodyMinHeight: nextBodyMinHeight,
        };
      });
    };

    syncActiveTurnLayout();

    const resizeObserver = new ResizeObserver(() => {
      syncActiveTurnLayout();
    });
    resizeObserver.observe(viewport);
    resizeObserver.observe(anchorNode);
    resizeObserver.observe(rowNode);

    return () => {
      resizeObserver.disconnect();
    };
  }, [computeActiveTurnBodyMinHeight, latestUserMessageId, selectedSessionId]);

  useEffect(() => {
    window.requestAnimationFrame(syncScrollFades);
  }, [
    timeline.items.length,
    showEmptyState,
    activeTurnLayout?.bodyMinHeight,
    isThinking,
    isLoading,
    syncScrollFades,
  ]);

  useEffect(() => {
    const nextStatusMap = new Map<string, "in-progress" | "completed" | "other">();
    const newlyCompletedRunIds: string[] = [];
    const shouldFreezeWorkedAutoCollapse =
      Boolean(latestUserMessageId) && isRunInProgress;

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
        if (workedAutoCollapsedRunIdsRef.current.has(runId)) {
          continue;
        }
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
      if (shouldFreezeWorkedAutoCollapse) {
        window.clearTimeout(timerId);
        workedCollapseTimersRef.current.delete(runId);
        return;
      }
      if (activeRunIds.has(runId)) return;
      window.clearTimeout(timerId);
      workedCollapseTimersRef.current.delete(runId);
    });

    if (shouldFreezeWorkedAutoCollapse) {
      return;
    }

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
  }, [timeline.items, isRunInProgress, latestUserMessageId]);

  const onSuggestionClick = (suggestion: string) => setInput(suggestion);
  const shouldShowInterruptedContinue =
    !activeQuestionRequest &&
    shouldSuggestInterruptedContinueFromRecords({
      sessionStatus: sessionDebugState.sessionStatus,
      messages: selectedMessages,
      isThinking,
      isLoading,
    });
  const activeTurnBodyMinHeight =
    activeTurnUserItem && activeTurnLayout?.messageId === activeTurnUserItem.message.id
      ? activeTurnLayout.bodyMinHeight
      : 0;

  const renderTimelineItem = (item: CanonicalTimelineItem) =>
    item.kind === "user" ? (
      <UserMessageRow
        key={item.key}
        message={item.message}
        onRevert={handleRevert}
        registerAnchor={setUserMessageRef}
        registerRow={setUserMessageRowRef}
        anchorTopInsetPx={CHAT_ANCHOR_TOP_INSET_PX}
      />
    ) : (
      <AgentMessageRow
        key={item.key}
        item={item}
        orderedParts={item.orderedParts}
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
    );

  const tailContent = (
    <>
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

      {sessionErrorNotice && (
        <SessionStatusNotice
          notice={sessionErrorNotice}
          onDismiss={clearSessionError}
        />
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
        selectedMessages.length > 0 &&
        timeline.items[timeline.items.length - 1]?.kind === "agent" &&
        !activeQuestionRequest &&
        !isThinking &&
        !isLoading && <SessionDivider label="Done" className="mb-0" />}
    </>
  );

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        data-radix-scroll-area-viewport=""
        className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        <div
          ref={transcriptContentRef}
          data-chat-transcript-content=""
          className={cn(
            "flex flex-col gap-2 [overflow-anchor:none]",
            showEmptyState
              ? "px-0 pt-4 pb-10 md:px-0 md:pt-4 md:pb-12"
              : "px-4 pt-4 pb-16 md:px-6 md:pt-5 md:pb-20",
          )}
        >
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

        {selectedMessages.length === 0 &&
          (isSessionHydrating ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <LoadingSpinner message="Loading session..." />
            </div>
          ) : (
            <EmptyStatePrompt
              onSuggestionClick={onSuggestionClick}
              initialGenerationRequested={initialGenerationRequested}
              initialGenerationStarting={initialGenerationStarting}
              initialGenerationFailed={initialGenerationFailed}
              onRetryInitialGeneration={retryInitialGeneration}
            />
          ))}

        {historicalItems.map(renderTimelineItem)}

        {activeTurnUserItem ? (
          <div className="flex flex-col gap-2">
            <UserMessageRow
              key={activeTurnUserItem.key}
              message={activeTurnUserItem.message}
              onRevert={handleRevert}
              registerAnchor={setUserMessageRef}
              registerRow={setUserMessageRowRef}
              anchorTopInsetPx={CHAT_ANCHOR_TOP_INSET_PX}
            />
            <div
              data-chat-active-turn-body={activeTurnUserItem.message.id}
              className="flex min-h-0 flex-col gap-2"
              style={
                activeTurnBodyMinHeight > 0
                  ? { minHeight: `${activeTurnBodyMinHeight}px` }
                  : undefined
              }
            >
              {activeTurnAgentItems.map(renderTimelineItem)}
              {tailContent}
              <div aria-hidden="true" className="flex-1" />
            </div>
          </div>
        ) : (
          tailContent
        )}

        </div>
      </div>
      {showTopFade ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background via-background/84 to-transparent" />
      ) : null}
      {showBottomFade ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background via-background/88 to-transparent" />
      ) : null}
    </div>
  );
}

function UserMessageRow({
  message,
  onRevert,
  registerAnchor,
  registerRow,
  anchorTopInsetPx,
}: {
  message: Extract<CanonicalTimelineItem, { kind: "user" }>["message"];
  onRevert: (messageId: string) => void;
  registerAnchor: (messageId: string, node: HTMLDivElement | null) => void;
  registerRow: (messageId: string, node: HTMLDivElement | null) => void;
  anchorTopInsetPx: number;
}) {
  const { cleanMessage, internalTags } = parseVivdInternalTags(message.content);
  const imageTags = internalTags.filter((tag) => tag.type === "dropped-file");
  const fileTags = internalTags.filter((tag) => tag.type === "attached-file");
  const elementTag = internalTags.find((tag) => tag.type === "element-ref");
  const hasElementRef =
    Boolean(elementTag?.selector) || Boolean(elementTag?.["source-file"]);

  return (
    <div
      ref={(node) => registerRow(message.id, node)}
      data-chat-user-row-id={message.id}
      className="flex flex-col gap-1 items-end chat-row-enter"
    >
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

      <div
        ref={(node) => registerAnchor(message.id, node)}
        data-chat-user-anchor-id={message.id}
        className="max-w-[90%] min-w-0"
        style={{ scrollMarginTop: `${anchorTopInsetPx}px` }}
      >
        <div
          className="overflow-x-hidden rounded-[18px] bg-muted/40 px-3.5 py-1.5 text-foreground text-sm leading-[1.45] dark:bg-muted/10"
          data-chat-user-message-id={message.id}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={getChatMarkdownComponents({ compactParagraphs: true })}
          >
            {cleanMessage}
          </ReactMarkdown>

          {(imageTags.length > 0 || fileTags.length > 0 || hasElementRef) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
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
  item: Extract<CanonicalTimelineItem, { kind: "agent" }>;
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

function SessionStatusNotice({
  notice,
  onDismiss,
}: {
  notice: SessionErrorNoticeContent;
  onDismiss: () => void;
}) {
  const accentClass =
    notice.tone === "warning" ? "before:bg-amber-500/80" : "before:bg-destructive/80";
  const iconClass =
    notice.tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : "text-destructive";

  return (
    <div className="flex flex-col gap-1 w-full items-start chat-row-enter">
      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-md border border-border/50 bg-muted/20 pl-4 pr-2 py-2 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full ${accentClass}`}
      >
        <div className="flex items-start gap-2">
          <div className={`mt-0.5 shrink-0 ${iconClass}`}>
            {notice.showSpinner ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : notice.tone === "warning" ? (
              <AlertCircle className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-5 text-foreground break-words">
              {notice.title}
            </p>
            {notice.detail && (
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground break-words">
                {notice.detail}
              </p>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 text-muted-foreground/70 hover:text-foreground"
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
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
        <span className={`inline-flex max-w-full items-center gap-1 ${toneClass}`}>
          <span className="min-w-0">{label}</span>
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
