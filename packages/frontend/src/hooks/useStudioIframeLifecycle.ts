import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  isColorTheme,
  isTheme,
  type ColorTheme,
  type Theme,
} from "@vivd/shared/types";
import { isStudioIframeShellLoaded } from "@/lib/studioIframeReady";
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

  const syncThemeToStudio = useCallback(() => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;

    targetWindow.postMessage(
      { type: "vivd:host:theme", theme, colorTheme },
      "*",
    );
  }, [colorTheme, theme]);

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

      const type = event.data?.type;
      if (type === "vivd:studio:ready") {
        handleStudioReady();
        return;
      }

      if (type === "vivd:studio:close" || type === "vivd:studio:exitFullscreen") {
        onClose?.();
        return;
      }

      if (type === "vivd:studio:fullscreen") {
        onFullscreen?.();
        return;
      }

      if (type === "vivd:studio:navigate") {
        const path = event.data?.path;
        if (typeof path === "string" && path.startsWith("/")) {
          onNavigate?.(path);
        }
        return;
      }

      if (type === "vivd:studio:theme") {
        markStudioReady();

        const nextTheme = event.data?.theme;
        const nextColorTheme = event.data?.colorTheme;
        if (isTheme(nextTheme)) setTheme(nextTheme);
        if (isColorTheme(nextColorTheme)) setColorTheme(nextColorTheme);

        return;
      }

      if (type === "vivd:studio:hardRestart") {
        const versionRaw = event.data?.version;
        const requestedVersion =
          typeof versionRaw === "number" ? versionRaw : Number.NaN;
        onHardRestart?.(
          Number.isFinite(requestedVersion) ? requestedVersion : undefined,
        );
        return;
      }

      if (type === "vivd:studio:toggleSidebar") {
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
