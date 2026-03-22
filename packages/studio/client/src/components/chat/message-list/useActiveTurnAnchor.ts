import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type ActiveTurnLayout = {
  messageId: string;
  bodyMinHeight: number;
};

type PendingAnchorRequest = {
  messageId: string;
  behavior: ScrollBehavior;
};

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

  const CHAT_ANCHOR_TOP_INSET_PX = 40;
  const ACTIVE_TURN_BODY_GAP_PX = 8;
  const MAX_PENDING_ANCHOR_LAYOUT_ADJUSTMENTS = 1;

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
    setActiveTurnLayout(null);
    setPendingAnchorRequest(null);
  }, [selectedSessionId]);

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

    pendingAnchorLayoutAdjustmentsRef.current = 0;
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
    getScrollViewport,
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
  }, [getScrollViewport, selectedSessionId, syncScrollFades]);

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
    activeTurnLayout,
    registerUserAnchor,
    registerUserRow,
  };
}
