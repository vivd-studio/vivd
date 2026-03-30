import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  isColorTheme,
  isTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";
import { isStudioIframeShellLoaded } from "@/lib/studioIframeReady";
import {
  getVivdStudioBridgeOrigin,
  parseVivdStudioBridgeMessage,
} from "@/lib/studioBridge";
import { useStudioIframeReadyRetry } from "./useStudioIframeReadyRetry";
import { useStudioIframeTimeoutRecovery } from "./useStudioIframeTimeoutRecovery";

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
  const studioOrigin = getVivdStudioBridgeOrigin(studioBaseUrl);

  const syncThemeToStudio = useCallback(() => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !studioOrigin) return;

    targetWindow.postMessage(
      { type: "vivd:host:theme", theme, colorTheme },
      studioOrigin,
    );
  }, [colorTheme, studioOrigin, theme]);

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
      return false;
    }

    handleStudioReady();
    return true;
  }, [handleStudioReady]);

  const handleStudioIframeLoad = useCallback(() => {
    syncThemeToStudio();
    void tryMarkStudioReadyFromIframe();
  }, [syncThemeToStudio, tryMarkStudioReadyFromIframe]);

  const handleStudioIframeError = useCallback(() => {
    setStudioLoadErrored(true);
  }, []);

  useEffect(() => {
    syncThemeToStudio();
  }, [syncThemeToStudio]);

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

  return {
    studioReady,
    studioLoadTimedOut,
    studioLoadErrored,
    handleStudioIframeLoad,
    handleStudioIframeError,
  };
}
