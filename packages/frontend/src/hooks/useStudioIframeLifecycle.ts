import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  isColorTheme,
  isTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";
import { isStudioIframeShellLoaded } from "@/lib/studioIframeReady";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import {
  getVivdStudioBridgeOrigin,
  parseVivdStudioBridgeMessage,
} from "@/lib/studioBridge";
import { useStudioIframeReadyRetry } from "./useStudioIframeReadyRetry";
import { useStudioIframeTimeoutRecovery } from "./useStudioIframeTimeoutRecovery";

const EARLY_STALL_RECOVERY_DELAY_MS = 6_000;
const EARLY_STALL_RECOVERY_TIMEOUT_MS = 4_000;

type UseStudioIframeLifecycleOptions = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  studioBaseUrl: string | null;
  reloadNonce: number;
  reloadStudioIframe: () => Promise<void> | void;
  theme: Theme;
  colorTheme: ColorTheme;
  setTheme: (theme: Theme) => void;
  setColorTheme: (theme: ColorTheme) => void;
  onReady?: () => void;
  onClose?: () => void;
  onFullscreen?: () => void;
  onNavigate?: (path: string) => void;
  onToggleSidebar?: () => void;
  onHardRestart?: (version?: number) => void;
};

export function useStudioIframeLifecycle({
  iframeRef,
  studioBaseUrl,
  reloadNonce,
  reloadStudioIframe,
  theme,
  colorTheme,
  setTheme,
  setColorTheme,
  onReady,
  onClose,
  onFullscreen,
  onNavigate,
  onToggleSidebar,
  onHardRestart,
}: UseStudioIframeLifecycleOptions) {
  const [studioReady, setStudioReady] = useState(false);
  const [studioLoadTimedOut, setStudioLoadTimedOut] = useState(false);
  const [studioLoadErrored, setStudioLoadErrored] = useState(false);
  const attemptedEarlyRecoveryRef = useRef(false);
  const studioOrigin = getVivdStudioBridgeOrigin(studioBaseUrl);

  const postMessageToStudio = useCallback(
    (message: Record<string, unknown>) => {
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

  const requestStudioReadyCheck = useCallback(() => {
    postMessageToStudio({ type: "vivd:host:ready-check" });
  }, [postMessageToStudio]);

  const requestStudioBridgeSync = useCallback(() => {
    requestStudioReadyCheck();
    syncThemeToStudio();
  }, [requestStudioReadyCheck, syncThemeToStudio]);

  const markStudioReady = useCallback(() => {
    setStudioReady(true);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);
  }, []);

  const handleStudioReady = useCallback(() => {
    markStudioReady();
    syncThemeToStudio();
    onReady?.();
  }, [markStudioReady, onReady, syncThemeToStudio]);

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
    syncThemeToStudio();
  }, [syncThemeToStudio]);

  useEffect(() => {
    requestStudioBridgeSync();
  }, [requestStudioBridgeSync]);

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

      if (message.type === "vivd:studio:toggleSidebar") {
        onToggleSidebar?.();
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    handleStudioReady,
    markStudioReady,
    onClose,
    onFullscreen,
    onHardRestart,
    onNavigate,
    onToggleSidebar,
    setColorTheme,
    setTheme,
    studioOrigin,
  ]);

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
    enabled: Boolean(studioLoadTimedOut && studioBaseUrl && !studioReady),
    studioBaseUrl,
    onHealthyRuntimeDetected: handleHealthyRuntimeTimeoutRecovery,
  });

  useEffect(() => {
    attemptedEarlyRecoveryRef.current = false;
  }, [reloadNonce, studioBaseUrl]);

  useEffect(() => {
    if (!studioBaseUrl) {
      setStudioReady(false);
      setStudioLoadTimedOut(false);
      setStudioLoadErrored(false);
      return;
    }

    setStudioReady(false);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);

    const timeout = window.setTimeout(() => {
      setStudioLoadTimedOut(true);
    }, 25_000);

    return () => window.clearTimeout(timeout);
  }, [reloadNonce, studioBaseUrl]);

  useEffect(() => {
    if (!studioBaseUrl || studioReady || attemptedEarlyRecoveryRef.current) {
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
          resolveStudioRuntimeUrl(studioBaseUrl, "health"),
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
  }, [reloadStudioIframe, studioBaseUrl, studioReady]);

  return {
    studioReady,
    studioLoadTimedOut,
    studioLoadErrored,
    handleStudioIframeLoad,
    handleStudioIframeError,
  };
}
