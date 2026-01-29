import { usePreview } from "./PreviewContext";
import { StudioToolbar } from "./StudioToolbar";
import { MobileFrame } from "./MobileFrame";
import { PreviewIframe } from "./PreviewIframe";
import { UnsavedChangesBar } from "./UnsavedChangesBar";
import { Loader2, AlertCircle } from "lucide-react";

export function PreviewContent() {
  const {
    mobileView,
    selectedDevice,
    mobileScale,
    mobileContainerRef,
    iframeRef,
    refreshKey,
    fullUrl,
    iframeLoading,
    onIframeLoad,
    devServerStatus,
    devServerError,
    previewMode,
    isPreviewLoading,
  } = usePreview();

  // For dev server projects, don't render iframe until ready
  const isDevServerReady =
    !isPreviewLoading &&
    (previewMode === "static" || devServerStatus === "ready");

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
    <div className="flex flex-col w-full h-full overflow-hidden bg-gray-900">
      <StudioToolbar />

      <main className="flex flex-1 min-h-0 relative">
        <div
          ref={mobileContainerRef}
          className={`flex-1 relative bg-gray-800/50 ${
            mobileView ? "flex items-center justify-center overflow-hidden" : ""
          }`}
        >
          {/* Loading/Error Overlay */}
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center bg-gray-900 transition-opacity duration-150 ${
              isLoading || isDevServerError
                ? "opacity-100"
                : "opacity-0 pointer-events-none"
            }`}
          >
            {isDevServerError ? (
              <div className="flex flex-col items-center gap-3 max-w-md text-center px-4">
                <AlertCircle className="h-8 w-8 text-red-500" />
                <span className="text-sm font-medium text-red-500">
                  Dev server failed to start
                </span>
                {devServerError && (
                  <span className="text-xs text-gray-400 font-mono bg-gray-800 p-2 rounded max-h-32 overflow-auto">
                    {devServerError}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <span className="text-sm text-gray-400">
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
          )}

          <UnsavedChangesBar />
        </div>
      </main>
    </div>
  );
}
