import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type ActiveTurnLayout = {
  messageId: string;
  bodyMinHeight: number;
};

type PendingAnchorRequest = {
  messageId: string;
  behavior: ScrollBehavior;
};

const CHAT_ANCHOR_TOP_INSET_PX = 40;
const ACTIVE_TURN_BODY_GAP_PX = 8;
const MAX_PENDING_ANCHOR_LAYOUT_ADJUSTMENTS = 1;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 10;
const MANUAL_SCROLL_RESUME_THRESHOLD_PX = AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
const AUTO_SCROLL_MARK_TTL_MS = 1500;
const USER_SCROLL_DELTA_THRESHOLD_PX = 1;
const SCROLL_POSITION_EPSILON_PX = 2;

export function useActiveTurnAnchor({
  selectedSessionId,
  latestUserMessageId,
  isSessionHydrating,
  timelineItemCount,
  showEmptyState,
  isThinking,
  isLoading,
}: {
  selectedSessionId: string | null;
  latestUserMessageId: string | null;
  isSessionHydrating: boolean;
  timelineItemCount: number;
  showEmptyState: boolean;
  isThinking: boolean;
  isLoading: boolean;
}) {
  const [activeTurnLayout, setActiveTurnLayout] = useState<ActiveTurnLayout | null>(
    null,
  );
  const [pendingAnchorRequest, setPendingAnchorRequest] =
    useState<PendingAnchorRequest | null>(null);
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const userMessageRefs = useRef(new Map<string, HTMLDivElement>());
  const userMessageRowRefs = useRef(new Map<string, HTMLDivElement>());
  const lastAnchoredUserMessageIdRef = useRef<string | null>(null);
  const pendingHydrationAnchorRef = useRef(true);
  const pendingAnchorLayoutAdjustmentsRef = useRef(0);
  const autoScrollMarkRef = useRef<{ top: number; time: number } | null>(null);
  const autoScrollMarkTimerRef = useRef<number | null>(null);
  const skipNextResizeAutoScrollRef = useRef(false);
  const lastObservedScrollTopRef = useRef(0);
  // ResizeObserver and input handlers need the latest follow-state immediately.
  const userScrolledRef = useRef(false);
  const [userScrolled, setUserScrolled] = useState(false);

  const getScrollViewport = useCallback(
    (): HTMLDivElement | null => scrollViewportRef.current,
    [],
  );

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

  const canScrollViewport = useCallback((viewport: HTMLDivElement) => {
    return viewport.scrollHeight - viewport.clientHeight > 1;
  }, []);

  const getDistanceFromBottom = useCallback((viewport: HTMLDivElement) => {
    return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
  }, []);

  const setUserScrolledState = useCallback((next: boolean) => {
    userScrolledRef.current = next;
    setUserScrolled((prev) => (prev === next ? prev : next));
  }, []);

  const clearAutoScrollMark = useCallback(() => {
    if (autoScrollMarkTimerRef.current != null) {
      window.clearTimeout(autoScrollMarkTimerRef.current);
      autoScrollMarkTimerRef.current = null;
    }
    autoScrollMarkRef.current = null;
  }, []);

  const markAutoScroll = useCallback(
    (viewport: HTMLDivElement) => {
      autoScrollMarkRef.current = {
        top: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        time: Date.now(),
      };

      if (autoScrollMarkTimerRef.current != null) {
        window.clearTimeout(autoScrollMarkTimerRef.current);
      }

      autoScrollMarkTimerRef.current = window.setTimeout(() => {
        autoScrollMarkRef.current = null;
        autoScrollMarkTimerRef.current = null;
      }, AUTO_SCROLL_MARK_TTL_MS);
    },
    [],
  );

  const isAutoScrollPosition = useCallback((viewport: HTMLDivElement) => {
    const mark = autoScrollMarkRef.current;
    if (!mark) {
      return false;
    }

    if (Date.now() - mark.time > AUTO_SCROLL_MARK_TTL_MS) {
      autoScrollMarkRef.current = null;
      return false;
    }

    return (
      Math.abs(viewport.scrollTop - mark.top) < SCROLL_POSITION_EPSILON_PX
    );
  }, []);

  const scrollToBottom = useCallback(
    ({
      behavior = "auto",
      force = false,
    }: {
      behavior?: ScrollBehavior;
      force?: boolean;
    } = {}) => {
      const viewport = getScrollViewport();
      if (!viewport) {
        return;
      }

      if (!force && userScrolledRef.current) {
        return;
      }

      if (force) {
        setUserScrolledState(false);
      }

      const distanceFromBottom = getDistanceFromBottom(viewport);
      if (distanceFromBottom < 2) {
        markAutoScroll(viewport);
        return;
      }

      markAutoScroll(viewport);
      viewport.scrollTo({
        top: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        behavior,
      });
    },
    [
      getDistanceFromBottom,
      getScrollViewport,
      markAutoScroll,
      setUserScrolledState,
    ],
  );

  const pauseAutoScroll = useCallback(() => {
    const viewport = getScrollViewport();
    if (!viewport) {
      return;
    }

    if (!canScrollViewport(viewport)) {
      setUserScrolledState(false);
      return;
    }

    setUserScrolledState(true);
  }, [canScrollViewport, getScrollViewport, setUserScrolledState]);

  const resumeAutoScroll = useCallback(() => {
    scrollToBottom({ force: true });
  }, [scrollToBottom]);

  const registerUserAnchor = useCallback(
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

  const registerUserRow = useCallback(
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
  }, [getScrollViewport]);

  const computeActiveTurnBodyMinHeight = useCallback(
    (messageId: string) => {
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
    },
    [getScrollViewport, getTranscriptBottomPaddingPx],
  );

  useEffect(() => {
    pendingHydrationAnchorRef.current = true;
    lastAnchoredUserMessageIdRef.current = null;
    pendingAnchorLayoutAdjustmentsRef.current = 0;
    skipNextResizeAutoScrollRef.current = false;
    lastObservedScrollTopRef.current = 0;
    clearAutoScrollMark();
    setUserScrolledState(false);
    setActiveTurnLayout(null);
    setPendingAnchorRequest(null);
  }, [clearAutoScrollMark, selectedSessionId, setUserScrolledState]);

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
    pendingAnchorLayoutAdjustmentsRef.current = 0;
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
      pendingAnchorLayoutAdjustmentsRef.current = 0;
      setActiveTurnLayout(null);
      setPendingAnchorRequest(null);
    }
  }, [latestUserMessageId]);

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

    const nextLayout = {
      messageId: pendingAnchorRequest.messageId,
      bodyMinHeight: nextBodyMinHeight,
    };
    const layoutMatches =
      activeTurnLayout?.messageId === pendingAnchorRequest.messageId &&
      activeTurnLayout.bodyMinHeight === nextBodyMinHeight;

    if (!layoutMatches) {
      // Classic scrollbars can change the available width after overflow appears,
      // which can change wrapped user-message height and make this measurement
      // bounce between values. Only allow one synchronous retry here and let the
      // ResizeObserver-based background sync settle the final min-height.
      if (
        pendingAnchorLayoutAdjustmentsRef.current <
        MAX_PENDING_ANCHOR_LAYOUT_ADJUSTMENTS
      ) {
        pendingAnchorLayoutAdjustmentsRef.current += 1;
        setActiveTurnLayout(nextLayout);
        return;
      }

      setActiveTurnLayout((prev) => {
        if (
          prev?.messageId === nextLayout.messageId &&
          prev.bodyMinHeight === nextLayout.bodyMinHeight
        ) {
          return prev;
        }
        return nextLayout;
      });
    }

    const viewport = getScrollViewport();
    if (!viewport) {
      return;
    }

    const nextScrollTop = Math.max(
      0,
      viewport.scrollHeight - viewport.clientHeight,
    );
    const isAlreadyAnchored =
      Math.abs(viewport.scrollTop - nextScrollTop) <
      SCROLL_POSITION_EPSILON_PX;

    pendingAnchorLayoutAdjustmentsRef.current = 0;
    setUserScrolledState(false);
    skipNextResizeAutoScrollRef.current = true;
    markAutoScroll(viewport);
    if (!isAlreadyAnchored) {
      viewport.scrollTo({
        top: nextScrollTop,
        behavior: pendingAnchorRequest.behavior,
      });
    }
    syncScrollFades();
    lastAnchoredUserMessageIdRef.current = pendingAnchorRequest.messageId;
    setPendingAnchorRequest(null);
  }, [
    activeTurnLayout,
    computeActiveTurnBodyMinHeight,
    getScrollViewport,
    isSessionHydrating,
    markAutoScroll,
    pendingAnchorRequest,
    setUserScrolledState,
    syncScrollFades,
  ]);

  useEffect(() => {
    const viewport = getScrollViewport();
    if (!viewport) return;

    const syncViewportState = () => {
      const didUserScroll = userScrolledRef.current;
      viewport.style.overflowAnchor = didUserScroll ? "auto" : "none";
      const currentScrollTop = viewport.scrollTop;
      const previousScrollTop = lastObservedScrollTopRef.current;
      lastObservedScrollTopRef.current = currentScrollTop;

      if (!canScrollViewport(viewport)) {
        setUserScrolledState(false);
        syncScrollFades();
        return;
      }

      const distanceFromBottom = getDistanceFromBottom(viewport);
      const userScrolledUp =
        currentScrollTop <
          previousScrollTop - USER_SCROLL_DELTA_THRESHOLD_PX &&
        !isAutoScrollPosition(viewport);
      const inBottomResumeZone =
        distanceFromBottom <= MANUAL_SCROLL_RESUME_THRESHOLD_PX;

      if (userScrolledUp) {
        setUserScrolledState(true);
        syncScrollFades();
        return;
      }

      if (didUserScroll) {
        if (inBottomResumeZone) {
          setUserScrolledState(false);
        }
        syncScrollFades();
        return;
      }

      if (distanceFromBottom < AUTO_SCROLL_BOTTOM_THRESHOLD_PX) {
        setUserScrolledState(false);
        syncScrollFades();
        return;
      }

      if (!didUserScroll && isAutoScrollPosition(viewport)) {
        scrollToBottom();
        syncScrollFades();
        return;
      }

      syncScrollFades();
    };

    let frame = 0;
    const scheduleSync = () => {
      if (frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncViewportState();
      });
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0) {
        return;
      }
      pauseAutoScroll();
    };

    const handleInteraction = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        pauseAutoScroll();
      }
    };

    syncViewportState();
    viewport.addEventListener("scroll", scheduleSync, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: true });
    viewport.addEventListener("click", handleInteraction);

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        if (skipNextResizeAutoScrollRef.current) {
          const currentBottomPosition = Math.max(
            0,
            viewport.scrollHeight - viewport.clientHeight,
          );
          const anchoredBottomPosition = autoScrollMarkRef.current?.top;

          if (
            anchoredBottomPosition != null &&
            Math.abs(currentBottomPosition - anchoredBottomPosition) <
              SCROLL_POSITION_EPSILON_PX
          ) {
            skipNextResizeAutoScrollRef.current = false;
            scheduleSync();
            return;
          }

          skipNextResizeAutoScrollRef.current = false;
        }

        if (!pendingAnchorRequest && !userScrolledRef.current) {
          scrollToBottom();
        }

        scheduleSync();
      });
    });
    resizeObserver.observe(viewport);

    const viewportContent = transcriptContentRef.current ?? viewport.firstElementChild;
    if (viewportContent instanceof HTMLElement) {
      resizeObserver.observe(viewportContent);
    }

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      viewport.removeEventListener("scroll", scheduleSync);
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("click", handleInteraction);
      resizeObserver.disconnect();
    };
  }, [
    canScrollViewport,
    getDistanceFromBottom,
    getScrollViewport,
    isAutoScrollPosition,
    pauseAutoScroll,
    pendingAnchorRequest,
    scrollToBottom,
    selectedSessionId,
    setUserScrolledState,
    syncScrollFades,
  ]);

  useEffect(() => {
    return () => {
      clearAutoScrollMark();
    };
  }, [clearAutoScrollMark]);

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
      const nextBodyMinHeight =
        computeActiveTurnBodyMinHeight(latestUserMessageId);
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
  }, [
    computeActiveTurnBodyMinHeight,
    getScrollViewport,
    latestUserMessageId,
    selectedSessionId,
  ]);

  useEffect(() => {
    window.requestAnimationFrame(syncScrollFades);
  }, [
    activeTurnLayout?.bodyMinHeight,
    isLoading,
    isThinking,
    showEmptyState,
    syncScrollFades,
    timelineItemCount,
  ]);

  return {
    scrollViewportRef,
    transcriptContentRef,
    showTopFade,
    showBottomFade,
    showResumeScrollButton: userScrolled && showBottomFade,
    activeTurnLayout,
    registerUserAnchor,
    registerUserRow,
    resumeAutoScroll,
  };
}
