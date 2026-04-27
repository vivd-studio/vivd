import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";

import {
  detectStudioIframeFailure,
  isStudioIframeStartupPending,
  type StudioIframeFailure,
} from "@/lib/studioIframeFailure";
import { fetchStudioBootstrapStatus } from "@/lib/studioBootstrapStatus";

const STUDIO_USER_ACTION_TOKEN_PARAM = "userActionToken";
const BOOTSTRAP_RETRY_DELAYS_MS = [1_500, 4_000];
const STARTUP_RESPONSE_RETRY_DELAY_MS = 1_500;
const MAX_SILENT_BOOTSTRAP_FAILURE_RETRIES = 1;
const BOOTSTRAP_STATUS_NETWORK_RETRY_DELAY_MS = 1_500;

type StudioBootstrapIframeProps = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframeName: string;
  iframeKey: string;
  title: string;
  cleanSrc: string;
  bootstrapAction: string | null;
  bootstrapStatusUrl?: string | null;
  bootstrapToken: string | null;
  userActionToken: string | null;
  submissionKey: string;
  className?: string;
  allow?: string;
  allowFullScreen?: boolean;
  onLoad?: () => void;
  onError?: (failure?: StudioIframeFailure) => void;
};

export function StudioBootstrapIframe({
  iframeRef,
  iframeName,
  iframeKey,
  title,
  cleanSrc,
  bootstrapAction,
  bootstrapStatusUrl = null,
  bootstrapToken,
  userActionToken,
  submissionKey,
  className,
  allow,
  allowFullScreen,
  onLoad,
  onError,
}: StudioBootstrapIframeProps) {
  const bootstrapFormRef = useRef<HTMLFormElement | null>(null);
  const bootstrapStatusTimerRef = useRef<number | null>(null);
  const startupRetryTimerRef = useRef<number | null>(null);
  const silentBootstrapFailureRetriesRef = useRef(0);
  const shouldBootstrap = Boolean(bootstrapAction && bootstrapToken);
  const lastSubmittedFingerprintRef = useRef<string | null>(null);
  const [bootstrapReadyFingerprint, setBootstrapReadyFingerprint] =
    useState<string | null>(null);
  const bootstrapFingerprint = useMemo(
    () =>
      shouldBootstrap
        ? [
            submissionKey,
            bootstrapAction || "",
            bootstrapToken || "",
            userActionToken || "",
            cleanSrc,
          ].join("::")
        : null,
    [
      bootstrapAction,
      bootstrapToken,
      cleanSrc,
      shouldBootstrap,
      submissionKey,
      userActionToken,
    ],
  );
  const bootstrapReadinessKey =
    bootstrapFingerprint && bootstrapStatusUrl
      ? `${bootstrapFingerprint}::${bootstrapStatusUrl}`
      : bootstrapFingerprint;

  const isIframeAwaitingBootstrap = () => {
    const iframe = iframeRef.current;
    const frameWindow = iframe?.contentWindow;
    if (!frameWindow) return true;

    try {
      return frameWindow.location.href === "about:blank";
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!shouldBootstrap || !bootstrapFingerprint) {
      lastSubmittedFingerprintRef.current = null;
      setBootstrapReadyFingerprint(null);
      silentBootstrapFailureRetriesRef.current = 0;
      return;
    }

    const form = bootstrapFormRef.current;
    if (!form) return;
    if (
      bootstrapStatusUrl &&
      bootstrapReadyFingerprint !== bootstrapReadinessKey
    ) {
      return;
    }

    const submitBootstrap = () => {
      form.submit();
      lastSubmittedFingerprintRef.current = bootstrapFingerprint;
    };

    const iframeAwaitingBootstrap = isIframeAwaitingBootstrap();
    if (iframeAwaitingBootstrap || lastSubmittedFingerprintRef.current === null) {
      submitBootstrap();
    }

    const timers = BOOTSTRAP_RETRY_DELAYS_MS.map((delayMs) =>
      window.setTimeout(() => {
        if (
          lastSubmittedFingerprintRef.current === bootstrapFingerprint &&
          isIframeAwaitingBootstrap()
        ) {
          submitBootstrap();
        }
      }, delayMs),
    );

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [
    bootstrapFingerprint,
    bootstrapReadinessKey,
    bootstrapReadyFingerprint,
    bootstrapStatusUrl,
    iframeRef,
    shouldBootstrap,
  ]);

  useEffect(() => {
    if (!shouldBootstrap || !bootstrapFingerprint || !bootstrapStatusUrl) {
      setBootstrapReadyFingerprint(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const clearBootstrapStatusTimer = () => {
      if (bootstrapStatusTimerRef.current !== null) {
        window.clearTimeout(bootstrapStatusTimerRef.current);
        bootstrapStatusTimerRef.current = null;
      }
    };

    const scheduleStatusProbe = (delayMs: number) => {
      clearBootstrapStatusTimer();
      bootstrapStatusTimerRef.current = window.setTimeout(() => {
        bootstrapStatusTimerRef.current = null;
        void probeStatus();
      }, delayMs);
    };

    const probeStatus = async () => {
      try {
        const result = await fetchStudioBootstrapStatus(bootstrapStatusUrl, {
          signal: controller.signal,
        });
        if (cancelled) return;

        if (result.kind === "ready") {
          setBootstrapReadyFingerprint(bootstrapReadinessKey);
          return;
        }

        if (result.kind === "failed") {
          onError?.(result.failure);
          return;
        }

        scheduleStatusProbe(result.retryAfterMs);
      } catch {
        if (cancelled) return;
        scheduleStatusProbe(BOOTSTRAP_STATUS_NETWORK_RETRY_DELAY_MS);
      }
    };

    void probeStatus();

    return () => {
      cancelled = true;
      controller.abort();
      clearBootstrapStatusTimer();
    };
  }, [
    bootstrapFingerprint,
    bootstrapReadinessKey,
    bootstrapStatusUrl,
    onError,
    shouldBootstrap,
  ]);

  useEffect(() => {
    return () => {
      if (bootstrapStatusTimerRef.current !== null) {
        window.clearTimeout(bootstrapStatusTimerRef.current);
      }
      if (startupRetryTimerRef.current !== null) {
        window.clearTimeout(startupRetryTimerRef.current);
      }
    };
  }, []);

  const scheduleBootstrapRetry = (delayMs = STARTUP_RESPONSE_RETRY_DELAY_MS) => {
    const form = bootstrapFormRef.current;
    if (!form || !bootstrapFingerprint) return;

    if (startupRetryTimerRef.current !== null) {
      window.clearTimeout(startupRetryTimerRef.current);
    }

    startupRetryTimerRef.current = window.setTimeout(() => {
      if (lastSubmittedFingerprintRef.current !== bootstrapFingerprint) {
        return;
      }
      form.submit();
      startupRetryTimerRef.current = null;
    }, delayMs);
  };

  const handleIframeLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = event.currentTarget;
    let failure: StudioIframeFailure | null = null;
    let pathname = "";
    let bodyText = "";

    try {
      pathname = iframe.contentWindow?.location?.pathname || "";
      bodyText = iframe.contentDocument?.body?.textContent || "";
    } catch {
      pathname = "";
      bodyText = "";
    }

    if (
      shouldBootstrap &&
      isStudioIframeStartupPending({
        pathname,
        bodyText,
      })
    ) {
      scheduleBootstrapRetry();
      return;
    }

    try {
      failure = detectStudioIframeFailure({
        pathname,
        bodyText,
      });
    } catch {
      failure = null;
    }

    if (failure) {
      if (
        shouldBootstrap &&
        failure.source === "bootstrap" &&
        silentBootstrapFailureRetriesRef.current <
          MAX_SILENT_BOOTSTRAP_FAILURE_RETRIES
      ) {
        silentBootstrapFailureRetriesRef.current += 1;
        bootstrapFormRef.current?.submit();
        return;
      }

      if (startupRetryTimerRef.current !== null) {
        window.clearTimeout(startupRetryTimerRef.current);
        startupRetryTimerRef.current = null;
      }
      onError?.(failure);
      return;
    }

    onLoad?.();
  };

  const handleIframeError = () => {
    onError?.();
  };

  return (
    <>
      <iframe
        ref={iframeRef}
        key={iframeKey}
        name={iframeName}
        src={shouldBootstrap ? "about:blank" : cleanSrc}
        title={title}
        className={className}
        allow={allow}
        allowFullScreen={allowFullScreen}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
      />
      {shouldBootstrap ? (
        <form
          ref={bootstrapFormRef}
          method="post"
          action={bootstrapAction || undefined}
          target={iframeName}
          className="hidden"
          aria-hidden="true"
        >
          <input type="hidden" name="next" value={cleanSrc} />
          <input
            type="hidden"
            name="bootstrapToken"
            value={bootstrapToken || ""}
          />
          <input
            type="hidden"
            name={STUDIO_USER_ACTION_TOKEN_PARAM}
            value={userActionToken || ""}
          />
        </form>
      ) : null}
    </>
  );
}
