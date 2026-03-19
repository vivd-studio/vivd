import { useEffect } from "react";

import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 4_000;

type UseStudioIframeTimeoutRecoveryOptions = {
  enabled: boolean;
  studioBaseUrl: string | null;
  onHealthyRuntimeDetected: () => void;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
};

export function useStudioIframeTimeoutRecovery({
  enabled,
  studioBaseUrl,
  onHealthyRuntimeDetected,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: UseStudioIframeTimeoutRecoveryOptions) {
  useEffect(() => {
    if (!enabled || !studioBaseUrl) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, requestTimeoutMs);

      try {
        const response = await fetch(resolveStudioRuntimeUrl(studioBaseUrl, "health"), {
          method: "GET",
          mode: "cors",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!cancelled && response.ok) {
          onHealthyRuntimeDetected();
          return;
        }
      } catch {
        // Ignore transient health probe failures and keep polling while timed out.
      } finally {
        window.clearTimeout(timeout);
      }

      if (cancelled) return;
      timer = window.setTimeout(() => {
        void poll();
      }, pollIntervalMs);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled, onHealthyRuntimeDetected, pollIntervalMs, requestTimeoutMs, studioBaseUrl]);
}
