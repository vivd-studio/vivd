import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { StudioLoadFailurePanel } from "@/components/common/StudioLoadFailurePanel";
import { StudioRecoveryOverlay } from "@/components/common/StudioRecoveryOverlay";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { StudioBootstrapIframe } from "@/components/common/StudioBootstrapIframe";
import type { StudioIframeFailure } from "@/lib/studioIframeFailure";
import { cn } from "@/lib/utils";

const HANDOVER_MIN_COVER_MS = 250;
const HANDOVER_PAINT_SETTLE_MS = 80;
const HANDOVER_FADE_MS = 180;

type EmbeddedStudioLiveSurfaceProps = {
  projectSlug: string;
  studioIframeRef: RefObject<HTMLIFrameElement | null>;
  studioIframeTarget: string;
  studioIframeRequestKey: string;
  studioIframeSrc: string | null;
  studioBootstrapAction: string | null;
  studioBootstrapStatusUrl: string | null;
  studioBootstrapToken: string | null;
  studioUserActionToken: string | null;
  studioVisible: boolean;
  studioReady: boolean;
  studioLoadErrored: boolean;
  studioLoadTimedOut: boolean;
  studioLoadError: StudioIframeFailure | null;
  onStudioIframeLoad: () => void;
  onStudioIframeError: (failure?: StudioIframeFailure) => void;
  onReloadStudioIframe: () => void | Promise<void>;
  onHardRestart: () => void | Promise<void>;
  isHardRestartPending: boolean;
  isStudioRecovering: boolean;
  onStartupCoverDismissed?: () => void;
  startupHeader?: ReactNode;
  startupHeaderClassName?: string;
};

function getNow() {
  if (typeof performance !== "undefined") {
    return performance.now();
  }
  return Date.now();
}

export function EmbeddedStudioLiveSurface({
  projectSlug,
  studioIframeRef,
  studioIframeTarget,
  studioIframeRequestKey,
  studioIframeSrc,
  studioBootstrapAction,
  studioBootstrapStatusUrl,
  studioBootstrapToken,
  studioUserActionToken,
  studioVisible,
  studioReady,
  studioLoadErrored,
  studioLoadTimedOut,
  studioLoadError,
  onStudioIframeLoad,
  onStudioIframeError,
  onReloadStudioIframe,
  onHardRestart,
  isHardRestartPending,
  isStudioRecovering,
  onStartupCoverDismissed,
  startupHeader,
  startupHeaderClassName,
}: EmbeddedStudioLiveSurfaceProps) {
  const coverShownAtRef = useRef(getNow());
  const [startupCoverMounted, setStartupCoverMounted] = useState(true);
  const [startupCoverVisible, setStartupCoverVisible] = useState(true);
  const canRevealStudio = Boolean(
    studioIframeSrc && !studioLoadErrored && (studioReady || studioVisible),
  );

  useEffect(() => {
    if (!canRevealStudio) {
      coverShownAtRef.current = getNow();
      setStartupCoverMounted(true);
      setStartupCoverVisible(true);
      return;
    }

    setStartupCoverMounted(true);
    const elapsed = getNow() - coverShownAtRef.current;
    const revealDelay = Math.max(
      HANDOVER_PAINT_SETTLE_MS,
      HANDOVER_MIN_COVER_MS - elapsed,
    );
    let unmountTimer: number | null = null;
    const revealTimer = window.setTimeout(() => {
      setStartupCoverVisible(false);
      unmountTimer = window.setTimeout(() => {
        setStartupCoverMounted(false);
        onStartupCoverDismissed?.();
      }, HANDOVER_FADE_MS);
    }, revealDelay);

    return () => {
      window.clearTimeout(revealTimer);
      if (unmountTimer !== null) {
        window.clearTimeout(unmountTimer);
      }
    };
  }, [canRevealStudio, onStartupCoverDismissed, studioIframeRequestKey]);

  return (
    <div className="relative flex-1 min-h-0 border-l border-border/70 bg-background dark:border-white/10">
      <div className="relative h-full w-full">
        {studioIframeSrc ? (
          <StudioBootstrapIframe
            iframeRef={studioIframeRef}
            iframeName={studioIframeTarget}
            iframeKey={studioIframeRequestKey}
            title={`Vivd Studio - ${projectSlug}`}
            cleanSrc={studioIframeSrc}
            bootstrapAction={studioBootstrapAction}
            bootstrapStatusUrl={studioBootstrapStatusUrl}
            bootstrapToken={studioBootstrapToken}
            userActionToken={studioUserActionToken}
            submissionKey={studioIframeRequestKey}
            className="h-full w-full border-0"
            allow="fullscreen; clipboard-write"
            allowFullScreen
            onLoad={onStudioIframeLoad}
            onError={onStudioIframeError}
          />
        ) : null}

        {startupCoverMounted ? (
          <div
            className={cn(
              "absolute inset-0 z-10 bg-background transition-opacity duration-200 motion-reduce:transition-none",
              startupCoverVisible
                ? "opacity-100"
                : "pointer-events-none opacity-0",
            )}
            aria-hidden={!startupCoverVisible}
          >
            {studioLoadErrored ? (
              <div className="flex h-full w-full items-center justify-center px-6">
                <StudioLoadFailurePanel
                  failure={studioLoadError}
                  onReload={onReloadStudioIframe}
                  onHardRestart={onHardRestart}
                  isHardRestartPending={isHardRestartPending}
                />
              </div>
            ) : (
              <StudioStartupLoading
                className="h-full min-h-0"
                status={studioLoadTimedOut ? "stalled" : "loading"}
                onReload={onReloadStudioIframe}
                onHardRestart={onHardRestart}
                isHardRestartPending={isHardRestartPending}
                header={startupHeader}
                headerClassName={startupHeaderClassName}
              />
            )}
          </div>
        ) : null}

        {isStudioRecovering && studioReady ? <StudioRecoveryOverlay /> : null}
      </div>
    </div>
  );
}
