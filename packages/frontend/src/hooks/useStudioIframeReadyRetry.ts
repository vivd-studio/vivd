import { useEffect } from "react";

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_LATE_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 25_000;

type UseStudioIframeReadyRetryOptions = {
  enabled: boolean;
  checkReady: () => boolean;
  pollIntervalMs?: number;
  latePollIntervalMs?: number;
  timeoutMs?: number;
};

export function useStudioIframeReadyRetry({
  enabled,
  checkReady,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  latePollIntervalMs = DEFAULT_LATE_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: UseStudioIframeReadyRetryOptions) {
  useEffect(() => {
    if (!enabled) return;
    if (checkReady()) return;

    let cancelled = false;
    let timer: number | null = null;
    const deadline = Date.now() + timeoutMs;

    const poll = () => {
      if (cancelled) return;
      if (checkReady()) return;
      timer = window.setTimeout(
        poll,
        Date.now() >= deadline ? latePollIntervalMs : pollIntervalMs,
      );
    };

    timer = window.setTimeout(poll, pollIntervalMs);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [checkReady, enabled, latePollIntervalMs, pollIntervalMs, timeoutMs]);
}
