import { useEffect, useRef, type RefObject } from "react";

type StudioBootstrapIframeProps = {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframeName: string;
  iframeKey: string;
  title: string;
  cleanSrc: string;
  bootstrapAction: string | null;
  bootstrapToken: string | null;
  submissionKey: string;
  className?: string;
  allow?: string;
  allowFullScreen?: boolean;
  onLoad?: () => void;
  onError?: () => void;
};

export function StudioBootstrapIframe({
  iframeRef,
  iframeName,
  iframeKey,
  title,
  cleanSrc,
  bootstrapAction,
  bootstrapToken,
  submissionKey,
  className,
  allow,
  allowFullScreen,
  onLoad,
  onError,
}: StudioBootstrapIframeProps) {
  const bootstrapFormRef = useRef<HTMLFormElement | null>(null);
  const shouldBootstrap = Boolean(bootstrapAction && bootstrapToken);

  useEffect(() => {
    if (!shouldBootstrap) return;

    const form = bootstrapFormRef.current;
    if (!form) return;
    form.submit();
  }, [shouldBootstrap, submissionKey]);

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
        onLoad={onLoad}
        onError={onError}
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
        </form>
      ) : null}
    </>
  );
}
