import {
  lazy,
  Suspense,
  useMemo,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { ChatProvider } from "../chat/ChatContext";
import { OpencodeChatProvider } from "@/features/opencodeChat";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { usePreview } from "./PreviewContext";
import { StudioToolbar } from "./toolbar";
import { MobileFrame } from "./MobileFrame";
import { PreviewIframe } from "./PreviewIframe";
import { PreviewEditToolbar } from "./PreviewEditToolbar";
import { TABLET_PRESET } from "./types";
import type { AssetItem, FileTreeNode } from "../asset-explorer/types";
import { Loader2 } from "lucide-react";
import { isTextFile } from "../asset-explorer/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@vivd/ui";

import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { PreviewDevServerErrorPanel } from "./PreviewDevServerErrorPanel";

const ChatPanelContent = lazy(() =>
  import("../chat/ChatPanel").then((module) => ({
    default: module.ChatPanelContent,
  })),
);
const AssetExplorer = lazy(() =>
  import("../asset-explorer").then((module) => ({
    default: module.AssetExplorer,
  })),
);
const TextEditorPanel = lazy(() =>
  import("../asset-explorer/TextEditorPanel").then((module) => ({
    default: module.TextEditorPanel,
  })),
);
const ImageViewerPanel = lazy(() =>
  import("../asset-explorer/ImageViewerPanel").then((module) => ({
    default: module.ImageViewerPanel,
  })),
);
const PdfViewerPanel = lazy(() =>
  import("../asset-explorer/PdfViewerPanel").then((module) => ({
    default: module.PdfViewerPanel,
  })),
);
const AIEditDialog = lazy(() =>
  import("../asset-explorer/AIEditDialog").then((module) => ({
    default: module.AIEditDialog,
  })),
);
const CmsPanel = lazy(() =>
  import("../cms/CmsPanel").then((module) => ({
    default: module.CmsPanel,
  })),
);

function DeferredPanel({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const defaultFallback = (
    <div className="flex h-full w-full items-center justify-center bg-background/80">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  return <Suspense fallback={fallback ?? defaultFallback}>{children}</Suspense>;
}

export function PreviewContent() {
  const {
    projectSlug,
    version,
    viewportMode,
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
    handlePreviewLocationChange,
    assetPanel,
    chatPanel,
    cmsOpen,
    cmsMounted,
    setCmsOpen,
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
    imageDropChoiceRequest,
    resolveImageDropChoice,
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

  const isRestartingDevServer = restartDevServerMutation.isPending;
  const livePreviewRequiresRuntime = previewMode === "devserver";
  const isPreviewReady =
    Boolean(fullUrl) &&
    (!livePreviewRequiresRuntime ||
      (!isPreviewLoading && devServerStatus === "ready"));
  const isLoading = livePreviewRequiresRuntime
    ? iframeLoading ||
      isPreviewLoading ||
      devServerStatus === "starting" ||
      devServerStatus === "installing" ||
      isRestartingDevServer
    : Boolean(fullUrl) && iframeLoading;
  const isDevServerError =
    livePreviewRequiresRuntime &&
    devServerStatus === "error" &&
    !isRestartingDevServer;

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
      setViewingImagePath(prevFile.path);
    } else {
      setEditingTextFile(prevFile.path);
    }
  }, [
    canNavigatePrevious,
    navigableFiles,
    currentFileIndex,
    setViewingImagePath,
    setEditingTextFile,
  ]);

  const handleNavigateNext = useCallback(() => {
    if (!canNavigateNext) return;
    const nextFile = navigableFiles[currentFileIndex + 1];
    if (nextFile.isImage) {
      setViewingImagePath(nextFile.path);
    } else {
      setEditingTextFile(nextFile.path);
    }
  }, [
    canNavigateNext,
    navigableFiles,
    currentFileIndex,
    setViewingImagePath,
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

  const primaryImageDropChoice =
    imageDropChoiceRequest?.plan.choices.find((choice) => choice.primary) ??
    imageDropChoiceRequest?.plan.choices[0] ??
    null;
  const secondaryImageDropChoices =
    imageDropChoiceRequest?.plan.choices.filter(
      (choice) => choice.kind !== primaryImageDropChoice?.kind,
    ) ?? [];

  const framedViewport = viewportMode !== "desktop";
  const activeFrame = viewportMode === "tablet" ? TABLET_PRESET : selectedDevice;

  const assetPanelContent =
    projectSlug && version !== undefined && assetsOpen ? (
      <div
        className="absolute inset-0 z-30 max-md:!w-full md:relative md:inset-auto md:z-20 md:h-full md:min-w-0 md:flex-none"
        style={{ width: assetPanel.width }}
      >
        <div className="relative flex h-full flex-col overflow-hidden bg-background md:border-r md:border-border/40">
          <DeferredPanel>
            <AssetExplorer
              projectSlug={projectSlug}
              version={selectedVersion}
              onClose={() => setAssetsOpen(false)}
            />
          </DeferredPanel>
          <div className="hidden md:block">
            <ResizeHandle side="left" onMouseDown={assetPanel.handleMouseDown} />
          </div>
        </div>
      </div>
    ) : null;

  const chatPanelContent =
    projectSlug && chatOpen ? (
      <div
        className="absolute inset-0 z-40 max-md:!w-full md:relative md:inset-auto md:z-20 md:min-w-0"
        style={{ width: chatPanel.width }}
      >
        <div className="relative flex h-full flex-col overflow-hidden bg-background shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
          <div className="hidden md:block">
            <ResizeHandle side="left" onMouseDown={chatPanel.handleMouseDown} />
          </div>
          <DeferredPanel>
            <ChatPanelContent onClose={() => setChatOpen(false)} />
          </DeferredPanel>
        </div>
      </div>
    ) : null;

  // Inner content that needs ChatProvider context
  const mainContent = (
    <div className="flex flex-1 min-h-0 relative">
      {chatPanelContent}

      <div
        ref={mobileContainerRef}
        className={`flex-1 min-w-0 relative bg-background px-1 pb-1 pt-0 md:pb-1.5 md:pr-1.5 md:pt-0 ${
          chatOpen ? "md:pl-0" : "md:pl-1.5"
        } ${
          framedViewport ? "flex items-center justify-center overflow-hidden" : ""
        }`}
      >
        <div
          className={`relative flex h-full w-full overflow-hidden rounded-[10px] border border-border/60 bg-background shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${
            framedViewport ? "bg-muted/20" : ""
          }`}
        >
          {assetPanelContent}

          <div className="relative flex min-w-0 flex-1 flex-col">
            <PreviewEditToolbar />

            <div
              className={`relative min-h-0 flex-1 ${
                framedViewport
                  ? "flex items-center justify-center overflow-hidden"
                  : ""
              }`}
            >
              <div
                className={`absolute inset-0 z-10 flex items-center justify-center bg-background transition-opacity duration-150 ${
                  isLoading || isDevServerError
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none"
                }`}
              >
                {isDevServerError ? (
                  <PreviewDevServerErrorPanel
                    projectSlug={projectSlug}
                    version={selectedVersion}
                    devServerError={devServerError}
                    restartPending={restartDevServerMutation.isPending}
                    setChatOpen={setChatOpen}
                    onRestart={() => triggerDevServerRestart()}
                    onCleanReinstall={() =>
                      triggerDevServerRestart({ clean: true })
                    }
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {getLoadingMessage()}
                    </span>
                  </div>
                )}
              </div>

              {isPreviewReady ? (
                <div
                  className={`h-full transition-opacity duration-150 ${
                    iframeLoading ? "opacity-0" : "opacity-100"
                  } ${
                    framedViewport
                      ? "flex items-center justify-center overflow-hidden p-5"
                      : "w-full"
                  }`}
                >
                  {framedViewport ? (
                    <MobileFrame device={activeFrame} scale={mobileScale}>
                      <PreviewIframe
                        ref={iframeRef}
                        src={fullUrl}
                        refreshKey={refreshKey}
                        isMobile={viewportMode === "mobile"}
                        onNavigateStart={onIframeNavigateStart}
                        onLoad={onIframeLoad}
                        onLocationChange={handlePreviewLocationChange}
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
                      onLocationChange={handlePreviewLocationChange}
                      selectorMode={selectorMode}
                    />
                  )}
                </div>
              ) : null}

              {/* Text Editor - overlay on top of iframe to preserve iframe state */}
              {projectSlug && editingTextFile && (
                <DeferredPanel>
                  <TextEditorPanel
                    projectSlug={projectSlug}
                    version={selectedVersion}
                    filePath={editingTextFile}
                    onClose={() => setEditingTextFile(null)}
                  />
                </DeferredPanel>
              )}

              {projectSlug && cmsMounted && (
                <DeferredPanel>
                  <CmsPanel
                    projectSlug={projectSlug}
                    version={selectedVersion}
                    active={cmsOpen}
                    onClose={() => setCmsOpen(false)}
                  />
                </DeferredPanel>
              )}

              {/* Image Viewer - overlay on top of iframe similar to text editor */}
              {projectSlug && viewingImagePath && (
                <DeferredPanel>
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
                </DeferredPanel>
              )}

              {/* PDF Viewer - overlay on top of iframe similar to text editor */}
              {projectSlug && viewingPdfPath && (
                <DeferredPanel>
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
                </DeferredPanel>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Shared Dialogs */}
      {projectSlug && (
        <>
          <DeferredPanel fallback={null}>
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
          </DeferredPanel>

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
                  variant="destructive"
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

          <AlertDialog
            open={!!imageDropChoiceRequest}
            onOpenChange={(open) => {
              if (!open) resolveImageDropChoice(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Choose where this image lives</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      {imageDropChoiceRequest?.plan.label ??
                        "Choose how to use this image."}
                    </p>
                    {imageDropChoiceRequest?.plan.detail ? (
                      <p className="text-xs">
                        {imageDropChoiceRequest.plan.detail}
                      </p>
                    ) : null}
                    {imageDropChoiceRequest?.plan.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="text-xs text-amber-600 dark:text-amber-400"
                      >
                        {warning}
                      </p>
                    ))}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => resolveImageDropChoice(null)}>
                  Cancel
                </AlertDialogCancel>
                {secondaryImageDropChoices.map((choice) => (
                  <AlertDialogAction
                    key={choice.kind}
                    variant="outline"
                    onClick={() => resolveImageDropChoice(choice.kind)}
                  >
                    {choice.label}
                  </AlertDialogAction>
                ))}
                {primaryImageDropChoice ? (
                  <AlertDialogAction
                    onClick={() =>
                      resolveImageDropChoice(primaryImageDropChoice.kind)
                    }
                  >
                    {primaryImageDropChoice.label}
                  </AlertDialogAction>
                ) : null}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

    </div>
  );

  return (
    <div
      className={`flex flex-col overflow-hidden bg-background ${
        embedded ? "w-full h-dvh" : "w-screen h-dvh"
      }`}
    >
      {projectSlug && version !== undefined ? (
        <OpencodeChatProvider
          key={`opencode-chat-${projectSlug}-${version}`}
          projectSlug={projectSlug}
          version={version}
        >
          <ChatProvider
            key={`${projectSlug}-${version}`}
            projectSlug={projectSlug}
            version={version}
            onTaskComplete={handleTaskComplete}
          >
            <StudioToolbar />
            {mainContent}
          </ChatProvider>
        </OpencodeChatProvider>
      ) : (
        <>
          <StudioToolbar />
          {mainContent}
        </>
      )}
    </div>
  );
}
