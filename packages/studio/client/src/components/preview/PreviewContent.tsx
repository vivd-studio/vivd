import { useMemo, useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { ChatPanelContent } from "../chat/ChatPanel";
import { ChatProvider } from "../chat/ChatContext";
import { AssetExplorer } from "../asset-explorer";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { usePreview } from "./PreviewContext";
import { StudioToolbar } from "./toolbar";
import { MobileFrame } from "./MobileFrame";
import { PreviewIframe } from "./PreviewIframe";
import { UnsavedChangesBar } from "./UnsavedChangesBar";
import { TextEditorPanel } from "../asset-explorer/TextEditorPanel";
import { ImageViewerPanel } from "../asset-explorer/ImageViewerPanel";
import { PdfViewerPanel } from "../asset-explorer/PdfViewerPanel";
import type { AssetItem, FileTreeNode } from "../asset-explorer/types";
import { Loader2, AlertCircle } from "lucide-react";
import { AIEditDialog } from "../asset-explorer/AIEditDialog";
import { isTextFile } from "../asset-explorer/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

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
    handleRefresh,
    assetPanel,
    chatPanel,
    iframeLoading,
    onIframeNavigateStart,
    onIframeLoad,
    selectorMode,
    editingTextFile,
    setEditingTextFile,
    viewingImagePath,
    setViewingImagePath,
    viewingPdfPath,
    setViewingPdfPath,
    selectedVersion,
    devServerStatus,
    devServerError,
    previewMode,
    isPreviewLoading,
    embedded,
    editingAsset,
    setEditingAsset,
    pendingDeleteAsset,
    setPendingDeleteAsset,
  } = usePreview();

  const { canUseAiImages } = usePermissions();
  const [localEditPrompt, setLocalEditPrompt] = useState("");
  const utils = trpc.useUtils();
  const [restartKind, setRestartKind] = useState<"restart" | "clean" | null>(
    null,
  );

  const restartDevServerMutation = trpc.project.restartDevServer.useMutation({
    onSuccess: (result) => {
      if (!result.success) {
        toast.error("Dev server restart failed", {
          description:
            result.error || "Dev server could not be restarted right now",
        });
        return;
      }
      handleRefresh();
    },
    onError: (error) => {
      toast.error("Dev server restart failed", { description: error.message });
    },
    onSettled: () => {
      setRestartKind(null);
    },
  });

  // For dev server projects, don't render iframe until ready
  const isDevServerReady =
    !isPreviewLoading &&
    (previewMode === "static" || devServerStatus === "ready");

  // Show loading for both iframe loading AND dev server starting
  const isRestartingDevServer = restartDevServerMutation.isPending;
  const isLoading =
    iframeLoading ||
    isPreviewLoading ||
    devServerStatus === "starting" ||
    devServerStatus === "installing" ||
    isRestartingDevServer;
  const isDevServerError = devServerStatus === "error" && !isRestartingDevServer;

  // Determine loading message
  const getLoadingMessage = () => {
    if (isRestartingDevServer) {
      return restartKind === "clean"
        ? "Cleaning and restarting dev server..."
        : "Restarting dev server...";
    }
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

  const triggerDevServerRestart = useCallback(
    (options?: { clean?: boolean }) => {
      if (!projectSlug) return;
      setRestartKind(options?.clean ? "clean" : "restart");
      restartDevServerMutation.mutate({
        slug: projectSlug,
        version: selectedVersion,
        clean: options?.clean,
      });
    },
    [projectSlug, selectedVersion, restartDevServerMutation],
  );

  // ============================================
  // File Navigation Logic (for image viewer arrow keys)
  // ============================================

  // Query all assets when image viewer is open (for navigation)
  const allAssetsQuery = trpc.assets.listAllAssets.useQuery(
    { slug: projectSlug ?? "", version: selectedVersion, rootPath: "" },
    { enabled: !!projectSlug && !!viewingImagePath },
  );

  // Helper to flatten tree into a list of navigable files (images and text files)
  const flattenTree = useCallback((nodes: FileTreeNode[]): FileTreeNode[] => {
    const result: FileTreeNode[] = [];
    for (const node of nodes) {
      if (node.type === "file") {
        // Include images and text-based files (non-binary)
        if (node.isImage || isTextFile(node.name)) {
          result.push(node);
        }
      } else if (node.children) {
        result.push(...flattenTree(node.children));
      }
    }
    return result;
  }, []);

  // Compute flat navigable file list
  const navigableFiles = useMemo(() => {
    if (!allAssetsQuery.data?.tree) return [];
    return flattenTree(allAssetsQuery.data.tree);
  }, [allAssetsQuery.data?.tree, flattenTree]);

  // Find current file index
  const currentFileIndex = useMemo(() => {
    if (!viewingImagePath) return -1;
    return navigableFiles.findIndex((f) => f.path === viewingImagePath);
  }, [navigableFiles, viewingImagePath]);

  // Compute navigation state
  const canNavigatePrevious = currentFileIndex > 0;
  const canNavigateNext =
    currentFileIndex >= 0 && currentFileIndex < navigableFiles.length - 1;

  // Navigation handlers
  const handleNavigatePrevious = useCallback(() => {
    if (!canNavigatePrevious) return;
    const prevFile = navigableFiles[currentFileIndex - 1];
    if (prevFile.isImage) {
      setViewingPdfPath(null);
      setViewingImagePath(prevFile.path);
    } else {
      // Switch to text editor
      setViewingPdfPath(null);
      setViewingImagePath(null);
      setEditingTextFile(prevFile.path);
    }
  }, [
    canNavigatePrevious,
    navigableFiles,
    currentFileIndex,
    setViewingImagePath,
    setViewingPdfPath,
    setEditingTextFile,
  ]);

  const handleNavigateNext = useCallback(() => {
    if (!canNavigateNext) return;
    const nextFile = navigableFiles[currentFileIndex + 1];
    if (nextFile.isImage) {
      setViewingPdfPath(null);
      setViewingImagePath(nextFile.path);
    } else {
      // Switch to text editor
      setViewingPdfPath(null);
      setViewingImagePath(null);
      setEditingTextFile(nextFile.path);
    }
  }, [
    canNavigateNext,
    navigableFiles,
    currentFileIndex,
    setViewingImagePath,
    setViewingPdfPath,
    setEditingTextFile,
  ]);

  // ============================================
  // Asset Actions Logic
  // ============================================

  const deleteMutation = trpc.assets.deleteAsset.useMutation({
    onSuccess: () => {
      toast.success("Asset deleted successfully");
      utils.assets.listAssets.invalidate();
      utils.assets.listAllAssets.invalidate();
      setPendingDeleteAsset(null);
      if (viewingImagePath === pendingDeleteAsset?.path) {
        setViewingImagePath(null);
      }
      if (viewingPdfPath === pendingDeleteAsset?.path) {
        setViewingPdfPath(null);
      }
      if (editingTextFile === pendingDeleteAsset?.path) {
        setEditingTextFile(null);
      }
    },
    onError: (error) => {
      toast.error(`Failed to delete asset: ${error.message}`);
    },
  });

  const editImageMutation = trpc.assets.editImageWithAI.useMutation({
    onSuccess: (data) => {
      toast.success("Image edit requested");
      setEditingAsset(null);
      setLocalEditPrompt("");
      // Update viewing image to the new path if it was changed
      if (viewingImagePath === editingAsset?.path) {
        setViewingImagePath(data.newPath);
      }
    },
    onError: (error) => {
      toast.error(`Failed to edit image: ${error.message}`);
    },
  });

  const handleConfirmDelete = useCallback(() => {
    if (!projectSlug || !pendingDeleteAsset) return;
    deleteMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
      relativePath: pendingDeleteAsset.path,
    });
  }, [projectSlug, selectedVersion, pendingDeleteAsset, deleteMutation]);

  const handleSubmitAiEdit = useCallback(() => {
    if (!projectSlug || !editingAsset || !localEditPrompt.trim()) return;
    editImageMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
      relativePath: editingAsset.path,
      prompt: localEditPrompt.trim(),
    });
  }, [
    projectSlug,
    selectedVersion,
    editingAsset,
    localEditPrompt,
    editImageMutation,
  ]);

  const currentAsset = useMemo(() => {
    if (!viewingImagePath) return null;
    return navigableFiles[currentFileIndex] || null;
  }, [navigableFiles, currentFileIndex, viewingImagePath]);

  // Inner content that needs ChatProvider context
  const mainContent = (
    <div className="flex flex-1 min-h-0 relative">
      {/* Asset Explorer Panel - Left side */}
      {projectSlug && version !== undefined && assetsOpen && (
        <div
          className="relative border-r bg-background flex flex-col h-full shadow-xl z-20 overflow-hidden min-w-0"
          style={{ width: assetPanel.width }}
        >
          <AssetExplorer
            projectSlug={projectSlug}
            version={selectedVersion}
            onClose={() => setAssetsOpen(false)}
          />
          <ResizeHandle side="left" onMouseDown={assetPanel.handleMouseDown} />
        </div>
      )}

      <div
        ref={mobileContainerRef}
        className={`flex-1 relative bg-muted/20 ${
          mobileView ? "flex items-center justify-center overflow-hidden" : ""
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
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => triggerDevServerRestart()}
                  disabled={!projectSlug || restartDevServerMutation.isPending}
                >
                  Restart dev server
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => triggerDevServerRestart({ clean: true })}
                  disabled={!projectSlug || restartDevServerMutation.isPending}
                >
                  Clean reinstall
                </Button>
              </div>
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
                  onNavigateStart={onIframeNavigateStart}
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
                onNavigateStart={onIframeNavigateStart}
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

        {/* Image Viewer - overlay on top of iframe similar to text editor */}
        {projectSlug && viewingImagePath && (
          <ImageViewerPanel
            projectSlug={projectSlug}
            version={selectedVersion}
            filePath={viewingImagePath}
            onClose={() => setViewingImagePath(null)}
            onNavigatePrevious={handleNavigatePrevious}
            onNavigateNext={handleNavigateNext}
            canNavigatePrevious={canNavigatePrevious}
            canNavigateNext={canNavigateNext}
            onAiEdit={
              canUseAiImages && currentAsset
                ? () => setEditingAsset(currentAsset)
                : undefined
            }
            onDelete={
              currentAsset
                ? () => setPendingDeleteAsset(currentAsset)
                : undefined
            }
          />
        )}

        {/* PDF Viewer - overlay on top of iframe similar to text editor */}
        {projectSlug && viewingPdfPath && (
          <PdfViewerPanel
            projectSlug={projectSlug}
            version={selectedVersion}
            filePath={viewingPdfPath}
            onClose={() => setViewingPdfPath(null)}
            onDelete={() =>
              setPendingDeleteAsset({
                type: "file",
                name: viewingPdfPath.split("/").pop() || viewingPdfPath,
                path: viewingPdfPath,
              })
            }
          />
        )}
      </div>

      {/* Shared Dialogs */}
      {projectSlug && (
        <>
          <AIEditDialog
            open={!!editingAsset}
            editingImage={editingAsset as AssetItem | null}
            prompt={localEditPrompt}
            onPromptChange={setLocalEditPrompt}
            onClose={() => {
              setEditingAsset(null);
              setLocalEditPrompt("");
            }}
            onSubmit={handleSubmitAiEdit}
            isPending={editImageMutation.isPending}
            projectSlug={projectSlug}
            version={selectedVersion}
          />

          <AlertDialog
            open={!!pendingDeleteAsset}
            onOpenChange={(open) => {
              if (!open) setPendingDeleteAsset(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete asset?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingDeleteAsset ? (
                    <>
                      Delete <code>{pendingDeleteAsset.name}</code>? This cannot
                      be undone.
                    </>
                  ) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteMutation.isPending}
                  onClick={handleConfirmDelete}
                >
                  {deleteMutation.isPending ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting...
                    </span>
                  ) : (
                    "Delete"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {/* Chat Panel - Right side */}
      {projectSlug && chatOpen && (
        <div
          className="relative min-w-0 overflow-hidden border-l bg-background flex flex-col h-full shadow-xl z-20"
          style={{ width: chatPanel.width }}
        >
          <ResizeHandle side="right" onMouseDown={chatPanel.handleMouseDown} />
          <ChatPanelContent onClose={() => setChatOpen(false)} />
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`flex flex-col overflow-hidden bg-background ${
        embedded ? "w-full h-dvh" : "w-screen h-dvh"
      }`}
    >
      <StudioToolbar />

      {/* Wrap with ChatProvider when project context is available */}
      {projectSlug && version !== undefined ? (
        <ChatProvider
          key={`${projectSlug}-${version}`}
          projectSlug={projectSlug}
          version={version}
          onTaskComplete={handleTaskComplete}
        >
          {mainContent}
        </ChatProvider>
      ) : (
        mainContent
      )}
    </div>
  );
}
