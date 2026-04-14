import { useEffect } from "react";

import { fetchStudioHealthReady } from "@/lib/studioRuntimeHealth";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 4_000;

type UseStudioIframeTimeoutRecoveryOptions = {
  enabled: boolean;
  studioProbeBaseUrl: string | null;
  onHealthyRuntimeDetected: () => void;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
};

export function useStudioIframeTimeoutRecovery({
  enabled,
  studioProbeBaseUrl,
  onHealthyRuntimeDetected,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: UseStudioIframeTimeoutRecoveryOptions) {
  useEffect(() => {
    if (!enabled || !studioProbeBaseUrl) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort();
      }, requestTimeoutMs);

      try {
        const healthy = await fetchStudioHealthReady(
          studioProbeBaseUrl,
          {
            signal: controller.signal,
          },
        );
        if (!cancelled && healthy) {
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
  }, [
    enabled,
    onHealthyRuntimeDetected,
    pollIntervalMs,
    requestTimeoutMs,
    studioProbeBaseUrl,
  ]);
}
