import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/common";
import {
  Undo2,
  AlertTriangle,
  AlertCircle,
  CheckCheck,
  X,
  ArrowDownToLine,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOpencodeChat } from "@/features/opencodeChat";
import { cn } from "@/lib/utils";
import {
  buildCanonicalTimelineModel,
  shouldSuggestInterruptedContinueFromRecords,
  type CanonicalTimelineItem,
} from "@/features/opencodeChat/render/timeline";
import { EmptyStatePrompt } from "./EmptyStatePrompt";
import { useChatContext } from "./ChatContext";
import { buildSessionErrorNotice } from "./sessionErrorNotice";
import { AgentMessageRow } from "./message-list/AgentMessageRow";
import { SessionStatusNotice } from "./message-list/SessionStatusNotice";
import { SessionContextIndicator } from "./SessionContextIndicator";
import { UserMessageRow } from "./message-list/UserMessageRow";
import { useActiveTurnAnchor } from "./message-list/useActiveTurnAnchor";
import { useWorkedSectionState } from "./message-list/useWorkedSectionState";

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

  const isRunInProgress = isThinking || isLoading;

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
  const showEmptyState = selectedMessages.length === 0 && !isSessionHydrating;
  const {
    latestUserMessageId,
    historicalItems,
    activeTurnUserItem,
    activeTurnAgentItems,
  } = useMemo(() => splitTimelineAtLatestUser(timeline.items), [timeline.items]);

  const {
    scrollViewportRef,
    transcriptContentRef,
    showTopFade,
    showBottomFade,
    showResumeScrollButton,
    activeTurnLayout,
    registerUserAnchor,
    registerUserRow,
    resumeAutoScroll,
  } = useActiveTurnAnchor({
    selectedSessionId,
    latestUserMessageId,
    isSessionHydrating,
    timelineItemCount: timeline.items.length,
    showEmptyState,
    isThinking,
    isLoading,
  });

  const { workedOpenRunIds, toggleWorkedOpen } = useWorkedSectionState({
    selectedSessionId,
    timelineItems: timeline.items,
    latestUserMessageId,
    isRunInProgress,
  });

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
    activeTurnUserItem &&
    activeTurnLayout &&
    activeTurnLayout.messageId === activeTurnUserItem.message.id
      ? activeTurnLayout.bodyMinHeight
      : 0;
  const latestCompletedAgentTimestamp = useMemo(() => {
    const latestAgentItem = [...timeline.items]
      .reverse()
      .find((item) => item.kind === "agent");
    return latestAgentItem?.kind === "agent"
      ? latestAgentItem.completedAt ?? latestAgentItem.message?.completedAt
      : undefined;
  }, [timeline.items]);

  const renderTimelineItem = (item: CanonicalTimelineItem) =>
    item.kind === "user" ? (
      <UserMessageRow
        key={item.key}
        message={item.message}
        onRevert={handleRevert}
        registerAnchor={registerUserAnchor}
        registerRow={registerUserRow}
      />
    ) : (
      <AgentMessageRow
        key={item.key}
        item={item}
        orderedParts={item.orderedParts}
        workedOpen={workedOpenRunIds.has(item.runId)}
        onToggleWorked={() => toggleWorkedOpen(item.runId)}
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
        !isLoading && (
          <div className="flex justify-end pt-1 pb-0.5">
            <div className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground/55">
              <CheckCheck className="h-3 w-3 text-emerald-600/70" />
              {latestCompletedAgentTimestamp ? (
                <span>{formatMessageTime(latestCompletedAgentTimestamp)}</span>
              ) : null}
            </div>
          </div>
        )}
    </>
  );

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        data-testid="session-context-indicator-overlay"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-start px-3 pt-3 md:px-5 md:pt-2"
      >
        <div className="pointer-events-auto">
          <SessionContextIndicator />
        </div>
      </div>
      <div
        ref={scrollViewportRef}
        data-chat-scroll-viewport=""
        data-scrollbar-gutter-mode={showEmptyState ? "auto" : "stable"}
        className={cn(
          "h-full overflow-y-auto overscroll-contain [overflow-anchor:none]",
          showEmptyState
            ? "[scrollbar-gutter:auto]"
            : "[scrollbar-gutter:stable]",
        )}
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
              registerAnchor={registerUserAnchor}
              registerRow={registerUserRow}
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
      {showResumeScrollButton ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center md:bottom-6">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={resumeAutoScroll}
            className="pointer-events-auto h-8 w-8 rounded-full border-border/60 bg-background/95 shadow-sm hover:bg-muted/90"
            aria-label="Jump to latest message"
          >
            <ArrowDownToLine className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      {showTopFade ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background via-background/84 to-transparent" />
      ) : null}
      {showBottomFade ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background via-background/88 to-transparent" />
      ) : null}
    </div>
  );
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

type UserTimelineItem = Extract<CanonicalTimelineItem, { kind: "user" }>;

function isUserTimelineItem(item: CanonicalTimelineItem | undefined): item is UserTimelineItem {
  return item?.kind === "user";
}

function splitTimelineAtLatestUser(items: CanonicalTimelineItem[]) {
  let latestUserItemIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isUserTimelineItem(item) && item.message.id) {
      latestUserItemIndex = index;
      break;
    }
  }

  const latestUserItem =
    latestUserItemIndex >= 0 ? items[latestUserItemIndex] : undefined;
  const activeTurnUserItem = isUserTimelineItem(latestUserItem) ? latestUserItem : null;
  const latestUserMessageId = activeTurnUserItem?.message.id ?? null;
  const historicalItems =
    latestUserItemIndex >= 0 ? items.slice(0, latestUserItemIndex) : items;
  const activeTurnAgentItems = activeTurnUserItem
    ? items.slice(latestUserItemIndex + 1)
    : [];

  return {
    latestUserMessageId,
    historicalItems,
    activeTurnUserItem,
    activeTurnAgentItems,
  };
}
