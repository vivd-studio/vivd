import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { StudioRecoveryOverlay } from "@/components/common/StudioRecoveryOverlay";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { StudioBootstrapIframe } from "@/components/common/StudioBootstrapIframe";
import { Loader2 } from "lucide-react";

type EmbeddedStudioLiveSurfaceProps = {
  projectSlug: string;
  studioIframeRef: RefObject<HTMLIFrameElement | null>;
  studioIframeTarget: string;
  studioIframeRequestKey: string;
  studioIframeSrc: string;
  studioBootstrapAction: string | null;
  studioBootstrapToken: string | null;
  studioUserActionToken: string | null;
  studioVisible: boolean;
  studioReady: boolean;
  studioLoadTimedOut: boolean;
  studioLoadErrored: boolean;
  onStudioIframeLoad: () => void;
  onStudioIframeError: () => void;
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
  studioBootstrapToken,
  studioUserActionToken,
  studioVisible,
  studioReady,
  studioLoadTimedOut,
  studioLoadErrored,
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
            {studioLoadTimedOut || studioLoadErrored ? (
              <div className="flex h-full w-full items-center justify-center px-6">
                <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
                  <div className="text-base font-semibold">
                    Studio is taking longer than usual
                  </div>
                  <div className="text-sm text-muted-foreground">
                    The studio machine may still be booting or it might be
                    unresponsive (common after restarts). Try reloading the
                    iframe or doing a hard restart.
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void onReloadStudioIframe()}
                    >
                      Reload
                    </Button>
                    <Button
                      onClick={() => void onHardRestart()}
                      disabled={isHardRestartPending}
                    >
                      {isHardRestartPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Restarting…
                        </>
                      ) : (
                        "Hard restart"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <StudioStartupLoading
                className="h-full min-h-0"
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
