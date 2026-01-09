import { ChatPanel } from "../chat/ChatPanel";
import { AssetExplorer } from "../asset-explorer";
import { ResizeHandle } from "../ResizeHandle";
import { usePreview } from "./PreviewContext";
import { PreviewToolbar } from "./PreviewToolbar";
import { MobileFrame } from "./MobileFrame";
import { PreviewIframe } from "./PreviewIframe";
import { UnsavedChangesBar } from "./UnsavedChangesBar";
import { TextEditorPanel } from "../asset-explorer/TextEditorPanel";

import { Loader2, AlertCircle } from "lucide-react";

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
    selectorMode,
    editingTextFile,
    setEditingTextFile,
    selectedVersion,
    devServerStatus,
    devServerError,
    previewMode,
    isPreviewLoading,
  } = usePreview();

  // For dev server projects, don't render iframe until ready
  const isDevServerReady =
    !isPreviewLoading && (previewMode === "static" || devServerStatus === "ready");

  // Show loading for both iframe loading AND dev server starting
  const isLoading =
    iframeLoading ||
    isPreviewLoading ||
    devServerStatus === "starting" ||
    devServerStatus === "installing";
  const isDevServerError = devServerStatus === "error";

  // Determine loading message
  const getLoadingMessage = () => {
    if (isPreviewLoading) {
      return "Loading preview...";
    }
    if (devServerStatus === "installing") {
      return "Installing dependencies...";
    }
    if (devServerStatus === "starting") {
      return "Starting dev server...";
    }
    return "Loading preview...";
  };

  return (
    <>
      <div className="w-screen h-dvh flex flex-col overflow-hidden bg-background">
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
                version={selectedVersion}
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
            {/* Loading/Error Overlay */}
            <div
              className={`absolute inset-0 z-10 flex items-center justify-center bg-background transition-opacity duration-150 ${
                isLoading || isDevServerError
                  ? "opacity-100"
                  : "opacity-0 pointer-events-none"
              }`}
            >
              {isDevServerError ? (
                <div className="flex flex-col items-center gap-3 max-w-md text-center px-4">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <span className="text-sm font-medium text-destructive">
                    Dev server failed to start
                  </span>
                  {devServerError && (
                    <span className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded max-h-32 overflow-auto">
                      {devServerError}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">
                    {getLoadingMessage()}
                  </span>
                </div>
              )}
            </div>

            {/* Iframe container - only rendered when dev server is ready */}
            {isDevServerReady && (
              <div
                className={`transition-opacity duration-150 ${
                  iframeLoading ? "opacity-0" : "opacity-100"
                } ${mobileView ? "" : "w-full h-full"}`}
              >
                {mobileView ? (
                  <MobileFrame device={selectedDevice} scale={mobileScale}>
                    <PreviewIframe
                      ref={iframeRef}
                      src={fullUrl}
                      refreshKey={refreshKey}
                      isMobile={true}
                      onLoad={onIframeLoad}
                      selectorMode={selectorMode}
                    />
                  </MobileFrame>
                ) : (
                  <PreviewIframe
                    ref={iframeRef}
                    src={fullUrl}
                    refreshKey={refreshKey}
                    isMobile={false}
                    onLoad={onIframeLoad}
                    selectorMode={selectorMode}
                  />
                )}
              </div>
            )}

            <UnsavedChangesBar />

            {/* Text Editor - overlay on top of iframe to preserve iframe state */}
            {projectSlug && editingTextFile && (
              <TextEditorPanel
                projectSlug={projectSlug}
                version={selectedVersion}
                filePath={editingTextFile}
                onClose={() => setEditingTextFile(null)}
              />
            )}
          </div>

          {/* Chat Panel - Right side */}
          {projectSlug && chatOpen && (
            <div
              className="relative min-w-0 overflow-hidden border-l bg-background flex flex-col h-full shadow-xl z-20"
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
    </>
  );
}
