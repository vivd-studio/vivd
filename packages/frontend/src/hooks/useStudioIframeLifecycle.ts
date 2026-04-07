import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VivdHostBridgeMessage } from "@vivd/shared/studio";
import {
  isColorTheme,
  isTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";
import { isStudioIframeShellLoaded } from "@/lib/studioIframeReady";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import {
  canPostMessageToVivdStudio,
  getVivdStudioBridgeOrigin,
  parseVivdStudioBridgeMessage,
} from "@/lib/studioBridge";
import { useStudioIframeReadyRetry } from "./useStudioIframeReadyRetry";
import { useStudioIframeTimeoutRecovery } from "./useStudioIframeTimeoutRecovery";

const EARLY_STALL_RECOVERY_DELAY_MS = 6_000;
const EARLY_STALL_RECOVERY_TIMEOUT_MS = 4_000;

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
  const [studioReady, setStudioReady] = useState(false);
  const [studioLoadTimedOut, setStudioLoadTimedOut] = useState(false);
  const [studioLoadErrored, setStudioLoadErrored] = useState(false);
  const studioReadyRef = useRef(false);
  const attemptedEarlyRecoveryRef = useRef(false);
  const attemptedEarlyBlankReloadRef = useRef(false);
  const attemptedCrossOriginTimeoutReloadRef = useRef(false);
  const studioOrigin = getVivdStudioBridgeOrigin(studioBaseUrl);

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
    studioReadyRef.current = true;
    setStudioReady(true);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
  }, []);

  const handleStudioReady = useCallback(() => {
    const wasReady = studioReadyRef.current;
    markStudioReady();
    ackStudioReady();
    syncThemeToStudio();
    syncSidebarToStudio();
    if (!wasReady) {
      onReady?.();
    }
  }, [ackStudioReady, markStudioReady, onReady, syncSidebarToStudio, syncThemeToStudio]);

  const tryMarkStudioReadyFromIframe = useCallback(() => {
    if (!isStudioIframeShellLoaded(iframeRef.current)) {
      requestStudioBridgeSync();
      return false;
    }

    handleStudioReady();
    return true;
  }, [handleStudioReady, iframeRef, requestStudioBridgeSync]);

  const handleStudioIframeLoad = useCallback(() => {
    requestStudioBridgeSync();
    void tryMarkStudioReadyFromIframe();
  }, [requestStudioBridgeSync, tryMarkStudioReadyFromIframe]);

  const handleStudioIframeError = useCallback(() => {
    setStudioLoadErrored(true);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const studioWindow = iframeRef.current?.contentWindow;
      if (!studioWindow || event.source !== studioWindow) return;
      if (!studioOrigin || event.origin !== studioOrigin) return;

      const message = parseVivdStudioBridgeMessage(event);
      if (!message) return;

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
        markStudioReady();
        ackStudioReady();

        if (isTheme(message.theme)) setTheme(message.theme);
        if (isColorTheme(message.colorTheme)) setColorTheme(message.colorTheme);

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
    markStudioReady,
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
    enabled: Boolean(studioLoadTimedOut && studioHostProbeBaseUrl && !studioReady),
    studioProbeBaseUrl: studioHostProbeBaseUrl,
    onHealthyRuntimeDetected: handleHealthyRuntimeTimeoutRecovery,
  });

  useEffect(() => {
    attemptedEarlyRecoveryRef.current = false;
    attemptedEarlyBlankReloadRef.current = false;
    attemptedCrossOriginTimeoutReloadRef.current = false;
  }, [reloadNonce, studioBaseUrl]);

  useEffect(() => {
    if (!studioBaseUrl) {
      studioReadyRef.current = false;
      setStudioReady(false);
      setStudioLoadTimedOut(false);
      setStudioLoadErrored(false);
      return;
    }

    studioReadyRef.current = false;
    setStudioReady(false);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);

    const timeout = window.setTimeout(() => {
      setStudioLoadTimedOut(true);
    }, 25_000);

    return () => window.clearTimeout(timeout);
  }, [reloadNonce, studioBaseUrl]);

  useEffect(() => {
    if (
      !studioLoadTimedOut ||
      studioReady ||
      studioHostProbeBaseUrl ||
      !studioBaseUrl ||
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
  ]);

  useEffect(() => {
    if (
      studioHostProbeBaseUrl ||
      !studioBaseUrl ||
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
    studioReady,
  ]);

  useEffect(() => {
    if (
      !studioHostProbeBaseUrl ||
      studioReady ||
      attemptedEarlyRecoveryRef.current
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled || attemptedEarlyRecoveryRef.current || studioReady) return;

      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, EARLY_STALL_RECOVERY_TIMEOUT_MS);

      try {
        const response = await fetch(
          resolveStudioRuntimeUrl(studioHostProbeBaseUrl, "health"),
          {
            method: "GET",
            mode: "cors",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!cancelled && response.ok && !studioReady) {
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
  }, [reloadStudioIframe, studioHostProbeBaseUrl, studioReady]);

  return {
    studioReady,
    studioLoadTimedOut,
    studioLoadErrored,
    handleStudioIframeLoad,
    handleStudioIframeError,
  };
}
