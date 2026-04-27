import type { ReactNode, RefObject } from "react";

import { StudioLoadFailurePanel } from "@/components/common/StudioLoadFailurePanel";
import { StudioRecoveryOverlay } from "@/components/common/StudioRecoveryOverlay";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { StudioBootstrapIframe } from "@/components/common/StudioBootstrapIframe";
import type { StudioIframeFailure } from "@/lib/studioIframeFailure";

type EmbeddedStudioLiveSurfaceProps = {
  projectSlug: string;
  studioIframeRef: RefObject<HTMLIFrameElement | null>;
  studioIframeTarget: string;
  studioIframeRequestKey: string;
  studioIframeSrc: string;
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
  startupHeader?: ReactNode;
  startupHeaderClassName?: string;
};

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
  startupHeader,
  startupHeaderClassName,
}: EmbeddedStudioLiveSurfaceProps) {
  return (
    <div className="relative flex-1 min-h-0">
      <div className="relative h-full w-full">
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

        {!studioVisible ? (
          <div className="absolute inset-0 z-10 bg-background">
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
