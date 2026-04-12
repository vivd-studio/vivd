import { useCallback, useEffect, useRef, useState } from "react";

export function usePreviewIframeLoading() {
  const [iframeLoading, setIframeLoading] = useState(true);
  const iframeLoadingDelayTimerRef = useRef<number | null>(null);
  const iframeLoadWatchdogRef = useRef<number | null>(null);

  const clearIframeLoadingDelayTimer = useCallback(() => {
    if (iframeLoadingDelayTimerRef.current === null) return;
    window.clearTimeout(iframeLoadingDelayTimerRef.current);
    iframeLoadingDelayTimerRef.current = null;
  }, []);

  const clearIframeLoadWatchdog = useCallback(() => {
    if (iframeLoadWatchdogRef.current === null) return;
    window.clearTimeout(iframeLoadWatchdogRef.current);
    iframeLoadWatchdogRef.current = null;
  }, []);

  const startIframeLoadWatchdog = useCallback(() => {
    clearIframeLoadWatchdog();
    iframeLoadWatchdogRef.current = window.setTimeout(() => {
      iframeLoadWatchdogRef.current = null;
      setIframeLoading(false);
    }, 25_000);
  }, [clearIframeLoadWatchdog]);

  const beginIframeLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    clearIframeLoadWatchdog();
    setIframeLoading(true);
    startIframeLoadWatchdog();
  }, [clearIframeLoadingDelayTimer, clearIframeLoadWatchdog, startIframeLoadWatchdog]);

  const beginIframeNavigationLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    iframeLoadingDelayTimerRef.current = window.setTimeout(() => {
      iframeLoadingDelayTimerRef.current = null;
      setIframeLoading(true);
      startIframeLoadWatchdog();
    }, 150);
  }, [clearIframeLoadingDelayTimer, startIframeLoadWatchdog]);

  const endIframeLoading = useCallback(() => {
    clearIframeLoadingDelayTimer();
    clearIframeLoadWatchdog();
    setIframeLoading(false);
  }, [clearIframeLoadingDelayTimer, clearIframeLoadWatchdog]);

  useEffect(() => {
    return () => {
      clearIframeLoadingDelayTimer();
      clearIframeLoadWatchdog();
    };
  }, [clearIframeLoadingDelayTimer, clearIframeLoadWatchdog]);

  return {
    iframeLoading,
    beginIframeLoading,
    beginIframeNavigationLoading,
    endIframeLoading,
  };
}
