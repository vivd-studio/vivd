import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { RouteLoadingIndicator } from "@/components/common";

const MIN_VISIBLE_MS = 260;

/**
 * Shows a short, subtle top loading indicator on route pathname changes.
 * This keeps navigation feedback noticeable even when transitions are fast.
 */
export function RouteTransitionLoading() {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const hasMountedRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    setIsVisible(true);
    hideTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      hideTimerRef.current = null;
    }, MIN_VISIBLE_MS);

    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [location.pathname]);

  if (!isVisible) return null;

  return <RouteLoadingIndicator />;
}
