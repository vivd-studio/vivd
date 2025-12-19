import { ChatPanel } from "../ChatSidepanel";
import { AssetExplorer } from "../asset-explorer";
import { ResizeHandle } from "../ResizeHandle";
import { usePreview } from "./PreviewContext";
import { PreviewToolbar } from "./PreviewToolbar";
import { MobileFrame } from "./MobileFrame";
import { PreviewIframe } from "./PreviewIframe";
import { UnsavedChangesBar } from "./UnsavedChangesBar";
import { ExitConfirmationDialog } from "./ExitConfirmationDialog";
import { Loader2 } from "lucide-react";

export function PreviewContent() {
  const {
    projectSlug,
    version,
    mobileView,
    selectedDevice,
    mobileScale,
    mobileContainerRef,
    iframeRef,
    refreshKey,
    fullUrl,
    assetsOpen,
    setAssetsOpen,
    chatOpen,
    setChatOpen,
    handleTaskComplete,
    assetPanel,
    chatPanel,
    iframeLoading,
    onIframeLoad,
  } = usePreview();

  return (
    <>
      <div className="w-screen h-screen flex flex-col overflow-hidden bg-background">
        <PreviewToolbar />

        <div className="flex flex-1 min-h-0 relative">
          {/* Asset Explorer Panel - Left side */}
          {projectSlug && version !== undefined && assetsOpen && (
            <div
              className="relative border-r bg-background flex flex-col h-full shadow-xl z-20"
              style={{ width: assetPanel.width }}
            >
              <AssetExplorer
                projectSlug={projectSlug}
                version={version}
                onClose={() => setAssetsOpen(false)}
              />
              <ResizeHandle
                side="left"
                onMouseDown={assetPanel.handleMouseDown}
              />
            </div>
          )}

          <div
            ref={mobileContainerRef}
            className={`flex-1 relative bg-muted/20 ${
              mobileView
                ? "flex items-center justify-center overflow-hidden"
                : ""
            }`}
          >
            {/* Loading Overlay - fades out when done */}
            <div
              className={`absolute inset-0 z-10 flex items-center justify-center bg-background transition-opacity duration-150 ${
                iframeLoading ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  Loading preview...
                </span>
              </div>
            </div>

            {/* Iframe container with fade-in */}
            <div
              className={`w-full h-full transition-opacity duration-150 ${
                iframeLoading ? "opacity-0" : "opacity-100"
              }`}
            >
              {mobileView ? (
                <MobileFrame device={selectedDevice} scale={mobileScale}>
                  <PreviewIframe
                    ref={iframeRef}
                    src={fullUrl}
                    refreshKey={refreshKey}
                    isMobile={true}
                    onLoad={onIframeLoad}
                  />
                </MobileFrame>
              ) : (
                <PreviewIframe
                  ref={iframeRef}
                  src={fullUrl}
                  refreshKey={refreshKey}
                  isMobile={false}
                  onLoad={onIframeLoad}
                />
              )}
            </div>

            <UnsavedChangesBar />
          </div>

          {/* Chat Panel - Right side */}
          {projectSlug && chatOpen && (
            <div
              className="relative border-l bg-background flex flex-col h-full shadow-xl z-20"
              style={{ width: chatPanel.width }}
            >
              <ResizeHandle
                side="right"
                onMouseDown={chatPanel.handleMouseDown}
              />
              <ChatPanel
                key={`${projectSlug}-${version}`}
                projectSlug={projectSlug}
                version={version}
                onTaskComplete={handleTaskComplete}
                onClose={() => setChatOpen(false)}
              />
            </div>
          )}
        </div>
      </div>

      <ExitConfirmationDialog />
    </>
  );
}
