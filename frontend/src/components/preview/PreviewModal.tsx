import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChatPanel } from "../ChatSidepanel";
import { AssetExplorer } from "../asset-explorer";
import { ResizeHandle } from "../ResizeHandle";
import { PreviewModalProvider, usePreviewModal } from "./PreviewModalContext";
import { PreviewToolbar } from "./PreviewToolbar";
import { MobileFrame } from "./MobileFrame";
import { PreviewIframe } from "./PreviewIframe";
import { FloatingButtons } from "./FloatingButtons";
import { ExitConfirmationDialog } from "./ExitConfirmationDialog";
import type { PreviewModalProps } from "./types";

export function PreviewModal(props: PreviewModalProps) {
  if (!props.url) return null;

  return (
    <PreviewModalProvider {...props}>
      <PreviewModalContent />
    </PreviewModalProvider>
  );
}

function PreviewModalContent() {
  const {
    open,
    handleClose,
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
  } = usePreviewModal();

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-[100vw] w-screen h-screen flex flex-col p-0 gap-0 overflow-hidden rounded-none border-0">
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
              {mobileView ? (
                <MobileFrame device={selectedDevice} scale={mobileScale}>
                  <PreviewIframe
                    ref={iframeRef}
                    src={fullUrl}
                    refreshKey={refreshKey}
                    isMobile={true}
                  />
                </MobileFrame>
              ) : (
                <PreviewIframe
                  ref={iframeRef}
                  src={fullUrl}
                  refreshKey={refreshKey}
                  isMobile={false}
                />
              )}

              <FloatingButtons />
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
        </DialogContent>
      </Dialog>

      <ExitConfirmationDialog />
    </>
  );
}
