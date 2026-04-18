import {
  useEffect,
  useMemo,
  useRef,
  type RefObject,
  type SyntheticEvent,
} from "react";

import {
  detectStudioIframeFailure,
  type StudioIframeFailure,
} from "@/lib/studioIframeFailure";

const STUDIO_USER_ACTION_TOKEN_PARAM = "userActionToken";
const BOOTSTRAP_RETRY_DELAYS_MS = [1_500, 4_000];

type StudioBootstrapIframeProps = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframeName: string;
  iframeKey: string;
  title: string;
  cleanSrc: string;
  bootstrapAction: string | null;
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
  const shouldBootstrap = Boolean(bootstrapAction && bootstrapToken);
  const lastSubmittedFingerprintRef = useRef<string | null>(null);
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
      return;
    }

    const form = bootstrapFormRef.current;
    if (!form) return;

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
  }, [bootstrapFingerprint, iframeRef, shouldBootstrap]);

  const handleIframeLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = event.currentTarget;
    let failure: StudioIframeFailure | null = null;

    try {
      failure = detectStudioIframeFailure({
        pathname: iframe.contentWindow?.location?.pathname,
        bodyText: iframe.contentDocument?.body?.textContent,
      });
    } catch {
      failure = null;
    }

    if (failure) {
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
