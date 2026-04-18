import { useEffect, useState } from "react";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export type WakeLockStatus = "idle" | "active" | "unsupported" | "failed";

export function useScreenWakeLock(enabled: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>("idle");

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    if (typeof navigator === "undefined") {
      setStatus("unsupported");
      return;
    }

    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) {
      setStatus("unsupported");
      return;
    }

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (!nav.wakeLock) return;
      try {
        const next = await nav.wakeLock.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
        setStatus("active");
        next.addEventListener("release", () => {
          if (!cancelled) setStatus("idle");
        });
      } catch {
        setStatus("failed");
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinel) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel) {
        void sentinel.release();
        sentinel = null;
      }
    };
  }, [enabled]);

  return status;
}
