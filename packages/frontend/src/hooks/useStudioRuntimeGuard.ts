import { useCallback, useEffect, useRef, useState } from "react";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import { createStudioRuntimeSession } from "@/lib/studioRuntimeSession";

type EnsureStudioRunningResult =
  | {
      success: true;
      url: string;
      browserUrl?: string | null;
      runtimeUrl?: string | null;
      compatibilityUrl?: string | null;
      bootstrapToken: string | null;
      userActionToken?: string | null;
    }
  | {
      success: false;
      error?: string;
    };

type StudioRuntimeGuardTiming = {
  heartbeatIntervalMs: number;
  healthTimeoutMs: number;
  retryDelayMs: number;
  failureThreshold: number;
  recoveryCooldownMs: number;
};

const DEFAULT_TIMING: StudioRuntimeGuardTiming = {
  heartbeatIntervalMs: 20_000,
  healthTimeoutMs: 4_000,
  retryDelayMs: 1_200,
  failureThreshold: 2,
  recoveryCooldownMs: 20_000,
};

type UseStudioRuntimeGuardOptions = {
  enabled: boolean;
  studioProbeBaseUrl: string | null;
  touchStudio: () => void;
  ensureStudioRunning: () => Promise<EnsureStudioRunningResult>;
  onRecovered: (next: {
    url: string;
    browserUrl?: string | null;
    runtimeUrl?: string | null;
    compatibilityUrl?: string | null;
    bootstrapToken: string | null;
    userActionToken?: string | null;
  }) => void;
  onRecoveryError?: (message: string) => void;
  timing?: Partial<StudioRuntimeGuardTiming>;
};

type HealthCheckMode = "normal" | "retry-on-fail";

export function useStudioRuntimeGuard({
  enabled,
  studioProbeBaseUrl,
  touchStudio,
  ensureStudioRunning,
  onRecovered,
  onRecoveryError,
  timing,
}: UseStudioRuntimeGuardOptions) {
  const [isRecovering, setIsRecovering] = useState(false);

  const mergedTiming: StudioRuntimeGuardTiming = {
    ...DEFAULT_TIMING,
    ...timing,
  };

  const isMountedRef = useRef(true);
  const checkInFlightRef = useRef(false);
  const recoveryInFlightRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const lastRecoveryAtRef = useRef(0);
  const guardGenerationRef = useRef(0);
  const touchStudioRef = useRef(touchStudio);
  const ensureStudioRunningRef = useRef(ensureStudioRunning);
  const onRecoveredRef = useRef(onRecovered);
  const onRecoveryErrorRef = useRef(onRecoveryError);

  touchStudioRef.current = touchStudio;
  ensureStudioRunningRef.current = ensureStudioRunning;
  onRecoveredRef.current = onRecovered;
  onRecoveryErrorRef.current = onRecoveryError;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    guardGenerationRef.current += 1;
    consecutiveFailuresRef.current = 0;
    checkInFlightRef.current = false;
    recoveryInFlightRef.current = false;
    lastRecoveryAtRef.current = 0;
    setIsRecovering(false);
  }, [studioProbeBaseUrl, enabled]);

  const pingStudioHealth = useCallback(async () => {
    if (!studioProbeBaseUrl) return false;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, mergedTiming.healthTimeoutMs);

    try {
      const response = await fetch(
        resolveStudioRuntimeUrl(studioProbeBaseUrl, "health"),
        {
          method: "GET",
          mode: "cors",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [studioProbeBaseUrl, mergedTiming.healthTimeoutMs]);

  const recoverStudio = useCallback(async (guardGeneration: number) => {
    if (recoveryInFlightRef.current) return;

    const now = Date.now();
    if (now - lastRecoveryAtRef.current < mergedTiming.recoveryCooldownMs) {
      return;
    }
    lastRecoveryAtRef.current = now;

    recoveryInFlightRef.current = true;
    if (isMountedRef.current && guardGenerationRef.current === guardGeneration) {
      setIsRecovering(true);
    }

    try {
      const result = await ensureStudioRunningRef.current();
      if (guardGenerationRef.current !== guardGeneration) return;

      if (result.success) {
        onRecoveredRef.current(createStudioRuntimeSession(result));
        return;
      }
      onRecoveryErrorRef.current?.(result.error || "Failed to wake studio runtime");
    } catch (error) {
      if (guardGenerationRef.current !== guardGeneration) return;

      const message = error instanceof Error ? error.message : String(error);
      onRecoveryErrorRef.current?.(message);
    } finally {
      if (guardGenerationRef.current === guardGeneration) {
        recoveryInFlightRef.current = false;
      }
      if (isMountedRef.current && guardGenerationRef.current === guardGeneration) {
        setIsRecovering(false);
      }
    }
  }, [mergedTiming.recoveryCooldownMs]);

  const runHealthCheck = useCallback(
    async (mode: HealthCheckMode = "normal") => {
      if (!enabled || !studioProbeBaseUrl || checkInFlightRef.current) return;

      const guardGeneration = guardGenerationRef.current;
      checkInFlightRef.current = true;

      try {
        touchStudioRef.current();
        const healthy = await pingStudioHealth();
        if (guardGenerationRef.current !== guardGeneration) return;

        if (healthy) {
          consecutiveFailuresRef.current = 0;
          return;
        }

        let failureIncrement = 1;
        if (mode === "retry-on-fail") {
          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), mergedTiming.retryDelayMs);
          });
          if (guardGenerationRef.current !== guardGeneration) return;

          touchStudioRef.current();
          const retryHealthy = await pingStudioHealth();
          if (guardGenerationRef.current !== guardGeneration) return;
          if (retryHealthy) {
            consecutiveFailuresRef.current = 0;
            return;
          }

          // A retry-on-fail probe already performed back-to-back checks. Treat both misses
          // as enough confidence to recover immediately instead of waiting for the next interval.
          failureIncrement = mergedTiming.failureThreshold;
        }

        consecutiveFailuresRef.current += failureIncrement;
        if (consecutiveFailuresRef.current >= mergedTiming.failureThreshold) {
          consecutiveFailuresRef.current = 0;
          await recoverStudio(guardGeneration);
        }
      } finally {
        if (guardGenerationRef.current === guardGeneration) {
          checkInFlightRef.current = false;
        }
      }
    },
    [
      enabled,
      mergedTiming.failureThreshold,
      mergedTiming.retryDelayMs,
      pingStudioHealth,
      recoverStudio,
      studioProbeBaseUrl,
    ],
  );

  useEffect(() => {
    if (!enabled || !studioProbeBaseUrl) return;

    void runHealthCheck("retry-on-fail");

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void runHealthCheck();
    }, mergedTiming.heartbeatIntervalMs);

    const onFocus = () => {
      void runHealthCheck("retry-on-fail");
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runHealthCheck("retry-on-fail");
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    enabled,
    mergedTiming.heartbeatIntervalMs,
    runHealthCheck,
    studioProbeBaseUrl,
  ]);

  return {
    isRecovering,
  };
}
