import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VivdHostBridgeMessage } from "@vivd/shared/studio";
import {
  isTheme,
  normalizeColorTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";
import {
  isStudioIframePresented,
  isStudioIframeShellLoaded,
} from "@/lib/studioIframeReady";
import {
  canPostMessageToVivdStudio,
  getVivdStudioBridgeOrigin,
  parseVivdStudioBridgeMessage,
} from "@/lib/studioBridge";
import { fetchStudioHealthReady } from "@/lib/studioRuntimeHealth";
import { STUDIO_LOAD_TIMEOUT_MS } from "@/lib/studioStartupTimings";
import type { StudioIframeFailure } from "@/lib/studioIframeFailure";
import { useStudioIframeReadyRetry } from "./useStudioIframeReadyRetry";
import { useStudioIframeTimeoutRecovery } from "./useStudioIframeTimeoutRecovery";

const EARLY_STALL_RECOVERY_DELAY_MS = 6_000;
const EARLY_STALL_RECOVERY_TIMEOUT_MS = 4_000;
const STUDIO_LOAD_ERROR_DISPLAY_DELAY_MS = 4_000;

function isIframeStillOnAboutBlank(
  iframe: HTMLIFrameElement | null,
): boolean {
  const targetWindow = iframe?.contentWindow;
  if (!targetWindow) return false;

  try {
    return targetWindow.location.href === "about:blank";
  } catch {
    return false;
  }
}

type UseStudioIframeLifecycleOptions = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  studioBaseUrl: string | null;
  studioHostProbeBaseUrl: string | null;
  reloadNonce: number;
  reloadStudioIframe: () => Promise<void> | void;
  sidebarOpen?: boolean;
  theme: Theme;
  colorTheme: ColorTheme;
  setTheme: (theme: Theme) => void;
  setColorTheme: (theme: ColorTheme) => void;
  onReady?: () => void;
  onClose?: () => void;
  onFullscreen?: () => void;
  onNavigate?: (path: string) => void;
  onShowSidebarPeek?: () => void;
  onScheduleHideSidebarPeek?: () => void;
  onToggleSidebar?: () => void;
  onHardRestart?: (version?: number) => void;
  onTransportDegraded?: (
    signal: {
      transport: "trpc-http";
      reason: "network-error" | "timeout";
    },
  ) => void;
};

export function useStudioIframeLifecycle({
  iframeRef,
  studioBaseUrl,
  studioHostProbeBaseUrl,
  reloadNonce,
  reloadStudioIframe,
  sidebarOpen,
  theme,
  colorTheme,
  setTheme,
  setColorTheme,
  onReady,
  onClose,
  onFullscreen,
  onNavigate,
  onShowSidebarPeek,
  onScheduleHideSidebarPeek,
  onToggleSidebar,
  onHardRestart,
  onTransportDegraded,
}: UseStudioIframeLifecycleOptions) {
  const [studioVisible, setStudioVisible] = useState(false);
  const [studioReady, setStudioReady] = useState(false);
  const [studioLoadTimedOut, setStudioLoadTimedOut] = useState(false);
  const [studioLoadErrored, setStudioLoadErrored] = useState(false);
  const [studioLoadError, setStudioLoadError] =
    useState<StudioIframeFailure | null>(null);
  const studioVisibleRef = useRef(false);
  const studioReadyRef = useRef(false);
  const attemptedEarlyRecoveryRef = useRef(false);
  const attemptedEarlyBlankReloadRef = useRef(false);
  const attemptedCrossOriginTimeoutReloadRef = useRef(false);
  const pendingStudioLoadErrorTimerRef = useRef<number | null>(null);
  const studioOrigin = getVivdStudioBridgeOrigin(studioBaseUrl);

  const clearPendingStudioLoadError = useCallback(() => {
    if (pendingStudioLoadErrorTimerRef.current !== null) {
      window.clearTimeout(pendingStudioLoadErrorTimerRef.current);
      pendingStudioLoadErrorTimerRef.current = null;
    }
  }, []);

  const postMessageToStudio = useCallback(
    (message: VivdHostBridgeMessage) => {
      if (
        !canPostMessageToVivdStudio({
          iframe: iframeRef.current,
          studioOrigin,
        })
      ) {
        return;
      }

      const targetWindow = iframeRef.current?.contentWindow;
      if (!targetWindow || !studioOrigin) return;

      targetWindow.postMessage(message, studioOrigin);
    },
    [iframeRef, studioOrigin],
  );

  const syncThemeToStudio = useCallback(() => {
    postMessageToStudio({
      type: "vivd:host:theme",
      theme,
      colorTheme,
    });
  }, [colorTheme, postMessageToStudio, theme]);

  const syncSidebarToStudio = useCallback(() => {
    if (typeof sidebarOpen !== "boolean") return;
    postMessageToStudio({
      type: "vivd:host:sidebar",
      open: sidebarOpen,
    });
  }, [postMessageToStudio, sidebarOpen]);

  const requestStudioReadyCheck = useCallback(() => {
    postMessageToStudio({ type: "vivd:host:ready-check" });
  }, [postMessageToStudio]);

  const ackStudioReady = useCallback(() => {
    postMessageToStudio({ type: "vivd:host:ready-ack" });
  }, [postMessageToStudio]);

  const requestStudioBridgeSync = useCallback(() => {
    requestStudioReadyCheck();
    syncThemeToStudio();
    syncSidebarToStudio();
  }, [requestStudioReadyCheck, syncSidebarToStudio, syncThemeToStudio]);

  const markStudioReady = useCallback(() => {
    clearPendingStudioLoadError();
    studioReadyRef.current = true;
    setStudioReady(true);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
    setStudioLoadError(null);
  }, [clearPendingStudioLoadError]);

  const markStudioVisible = useCallback(() => {
    clearPendingStudioLoadError();
    studioVisibleRef.current = true;
    setStudioVisible(true);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
    setStudioLoadError(null);
  }, [clearPendingStudioLoadError]);

  const handleStudioReady = useCallback(() => {
    const wasReady = studioReadyRef.current;
    markStudioVisible();
    markStudioReady();
    ackStudioReady();
    syncThemeToStudio();
    syncSidebarToStudio();
    if (!wasReady) {
      onReady?.();
    }
  }, [
    ackStudioReady,
    markStudioReady,
    markStudioVisible,
    onReady,
    syncSidebarToStudio,
    syncThemeToStudio,
  ]);

  const tryMarkStudioVisibleFromIframe = useCallback(() => {
    if (!isStudioIframePresented(iframeRef.current)) {
      return false;
    }

    markStudioVisible();
    return true;
  }, [iframeRef, markStudioVisible]);

  const tryMarkStudioReadyFromIframe = useCallback(() => {
    void tryMarkStudioVisibleFromIframe();

    if (!isStudioIframeShellLoaded(iframeRef.current)) {
      requestStudioBridgeSync();
      return false;
    }

    handleStudioReady();
    return true;
  }, [
    handleStudioReady,
    iframeRef,
    requestStudioBridgeSync,
    tryMarkStudioVisibleFromIframe,
  ]);

  const handleStudioIframeLoad = useCallback(() => {
    clearPendingStudioLoadError();
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
    setStudioLoadError(null);
    void tryMarkStudioVisibleFromIframe();
    requestStudioBridgeSync();
    void tryMarkStudioReadyFromIframe();
  }, [
    clearPendingStudioLoadError,
    requestStudioBridgeSync,
    tryMarkStudioReadyFromIframe,
    tryMarkStudioVisibleFromIframe,
  ]);

  const handleStudioIframeError = useCallback((failure?: StudioIframeFailure) => {
    clearPendingStudioLoadError();
    setStudioLoadError(
      failure ?? {
        message: "Studio failed to load",
        source: "network",
      },
    );
    const errorDisplayDelayMs =
      failure?.retryable === false || failure?.code
        ? 0
        : STUDIO_LOAD_ERROR_DISPLAY_DELAY_MS;
    pendingStudioLoadErrorTimerRef.current = window.setTimeout(() => {
      pendingStudioLoadErrorTimerRef.current = null;
      setStudioLoadErrored(true);
    }, errorDisplayDelayMs);
  }, [clearPendingStudioLoadError]);

  const recheckStudioReadiness = useCallback(() => {
    if (!studioBaseUrl) return;
    void tryMarkStudioVisibleFromIframe();
    if (studioReadyRef.current) return;
    void tryMarkStudioReadyFromIframe();
  }, [studioBaseUrl, tryMarkStudioReadyFromIframe, tryMarkStudioVisibleFromIframe]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const studioWindow = iframeRef.current?.contentWindow;
      if (!studioWindow || event.source !== studioWindow) return;
      if (!studioOrigin || event.origin !== studioOrigin) return;

      const message = parseVivdStudioBridgeMessage(event);
      if (!message) return;

      if (message.type === "vivd:studio:presented") {
        markStudioVisible();
        requestStudioBridgeSync();
        return;
      }

      if (message.type === "vivd:studio:ready") {
        handleStudioReady();
        return;
      }

      if (
        message.type === "vivd:studio:close" ||
        message.type === "vivd:studio:exitFullscreen"
      ) {
        onClose?.();
        return;
      }

      if (message.type === "vivd:studio:fullscreen") {
        onFullscreen?.();
        return;
      }

      if (message.type === "vivd:studio:navigate") {
        if (message.path.startsWith("/")) {
          onNavigate?.(message.path);
        }
        return;
      }

      if (message.type === "vivd:studio:theme") {
        markStudioVisible();
        markStudioReady();
        ackStudioReady();

        if (isTheme(message.theme)) setTheme(message.theme);
        setColorTheme(normalizeColorTheme(message.colorTheme));

        return;
      }

      if (message.type === "vivd:studio:hardRestart") {
        onHardRestart?.(
          Number.isFinite(message.version) ? message.version : undefined,
        );
        return;
      }

      if (message.type === "vivd:studio:showSidebarPeek") {
        onShowSidebarPeek?.();
        return;
      }

      if (message.type === "vivd:studio:scheduleHideSidebarPeek") {
        onScheduleHideSidebarPeek?.();
        return;
      }

      if (message.type === "vivd:studio:transport-degraded") {
        onTransportDegraded?.({
          transport: message.transport,
          reason: message.reason,
        });
        return;
      }

      if (message.type === "vivd:studio:toggleSidebar") {
        onToggleSidebar?.();
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    handleStudioReady,
    ackStudioReady,
    markStudioVisible,
    markStudioReady,
    requestStudioBridgeSync,
    onClose,
    onFullscreen,
    onHardRestart,
    onNavigate,
    onScheduleHideSidebarPeek,
    onShowSidebarPeek,
    onTransportDegraded,
    onToggleSidebar,
    setColorTheme,
    setTheme,
    studioOrigin,
  ]);

  useEffect(() => {
    syncThemeToStudio();
  }, [syncThemeToStudio]);

  useEffect(() => {
    syncSidebarToStudio();
  }, [syncSidebarToStudio]);

  useEffect(() => {
    requestStudioBridgeSync();
  }, [requestStudioBridgeSync]);

  useEffect(() => {
    const onFocus = () => {
      recheckStudioReadiness();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recheckStudioReadiness();
      }
    };

    const onPageShow = () => {
      if (document.visibilityState === "visible") {
        recheckStudioReadiness();
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [recheckStudioReadiness]);

  useStudioIframeReadyRetry({
    enabled: Boolean(studioBaseUrl && !studioReady),
    checkReady: tryMarkStudioReadyFromIframe,
  });

  const handleHealthyRuntimeTimeoutRecovery = useCallback(() => {
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
    void reloadStudioIframe();
  }, [reloadStudioIframe]);

  useStudioIframeTimeoutRecovery({
    enabled: Boolean(
      studioLoadTimedOut &&
        studioHostProbeBaseUrl &&
        !studioReady &&
        !studioVisible,
    ),
    studioProbeBaseUrl: studioHostProbeBaseUrl,
    onHealthyRuntimeDetected: handleHealthyRuntimeTimeoutRecovery,
  });

  useEffect(() => {
    attemptedEarlyRecoveryRef.current = false;
    attemptedEarlyBlankReloadRef.current = false;
    attemptedCrossOriginTimeoutReloadRef.current = false;
  }, [reloadNonce, studioBaseUrl]);

  useEffect(() => {
    return () => {
      clearPendingStudioLoadError();
    };
  }, [clearPendingStudioLoadError]);

  useEffect(() => {
    if (!studioBaseUrl) {
      clearPendingStudioLoadError();
      studioVisibleRef.current = false;
      setStudioVisible(false);
      studioReadyRef.current = false;
      setStudioReady(false);
      setStudioLoadTimedOut(false);
      setStudioLoadErrored(false);
      setStudioLoadError(null);
      return;
    }

    clearPendingStudioLoadError();
    studioVisibleRef.current = false;
    setStudioVisible(false);
    studioReadyRef.current = false;
    setStudioReady(false);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
    setStudioLoadError(null);

    const timeout = window.setTimeout(() => {
      setStudioLoadTimedOut(true);
    }, STUDIO_LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [clearPendingStudioLoadError, reloadNonce, studioBaseUrl]);

  useEffect(() => {
    if (
      !studioLoadTimedOut ||
      studioReady ||
      studioHostProbeBaseUrl ||
      !studioBaseUrl ||
      studioVisible ||
      attemptedCrossOriginTimeoutReloadRef.current
    ) {
      return;
    }

    attemptedCrossOriginTimeoutReloadRef.current = true;
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
    void reloadStudioIframe();
  }, [
    reloadStudioIframe,
    studioBaseUrl,
    studioHostProbeBaseUrl,
    studioLoadTimedOut,
    studioReady,
    studioVisible,
  ]);

  useEffect(() => {
    if (
      studioHostProbeBaseUrl ||
      !studioBaseUrl ||
      studioVisible ||
      studioReady ||
      attemptedEarlyBlankReloadRef.current
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (
        cancelled ||
        studioReady ||
        attemptedEarlyBlankReloadRef.current ||
        !isIframeStillOnAboutBlank(iframeRef.current)
      ) {
        return;
      }

      attemptedEarlyBlankReloadRef.current = true;
      void reloadStudioIframe();
    }, EARLY_STALL_RECOVERY_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    iframeRef,
    reloadStudioIframe,
    studioBaseUrl,
    studioHostProbeBaseUrl,
    studioVisible,
    studioReady,
  ]);

  useEffect(() => {
    if (
      !studioHostProbeBaseUrl ||
      studioVisible ||
      studioReady ||
      attemptedEarlyRecoveryRef.current
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (
        cancelled ||
        attemptedEarlyRecoveryRef.current ||
        studioVisibleRef.current ||
        studioReady
      ) return;

      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, EARLY_STALL_RECOVERY_TIMEOUT_MS);

      try {
        const healthy = await fetchStudioHealthReady(
          studioHostProbeBaseUrl,
          {
            signal: controller.signal,
          },
        );

        if (!cancelled && healthy && !studioReady && !studioVisibleRef.current) {
          attemptedEarlyRecoveryRef.current = true;
          void reloadStudioIframe();
        }
      } catch {
        // Ignore transient probe failures. The normal timeout recovery still applies.
      } finally {
        window.clearTimeout(timeout);
      }
    }, EARLY_STALL_RECOVERY_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reloadStudioIframe, studioHostProbeBaseUrl, studioReady, studioVisible]);

  return {
    studioLifecycleState: studioReady
      ? "bridge_ready"
      : studioVisible
        ? "bridge_pending"
        : studioLoadErrored
          ? "terminal_failure"
          : studioLoadTimedOut
            ? "runtime_stalled"
            : "document_loading",
    studioVisible,
    studioReady,
    studioLoadTimedOut,
    studioLoadErrored,
    studioLoadError,
    handleStudioIframeLoad,
    handleStudioIframeError,
  };
}
