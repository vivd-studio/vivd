import { useState, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button, ScrollArea } from "@vivd/ui";

import { X, Plus, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { AssetItem, ViewMode, FileTreeNode } from "./types";
import {
  ASTRO_CONTENT_MEDIA_PATH,
  ASTRO_SHARED_MEDIA_PATH,
  buildImageUrl,
  pickAssetCreationTargetPath,
  pickInitialAssetExplorerPath,
  STUDIO_UPLOADS_PATH,
} from "./utils";
import {
  shouldShowWorkingImageOptimization,
  uploadFilesToStudioPath,
} from "./upload";
import { AssetToolbar } from "./AssetToolbar";
import { CreateFolderInput } from "./CreateFolderInput";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { CreateImageDialog } from "./CreateImageDialog";
import { ViewModeToggle } from "./ViewModeToggle";
import { ImageGalleryView } from "./ImageGalleryView";
import { FileTreeView } from "./FileTreeView";
import { usePermissions } from "@/hooks/usePermissions";
import { usePreview } from "@/components/preview/PreviewContext";
import { useOptionalChatContext } from "@/components/chat/ChatContext";

interface AssetExplorerProps {
  projectSlug: string;
  version: number;
  onClose?: () => void;
}

const MEDIA_LIBRARY_ROOTS = {
  managed: ASTRO_CONTENT_MEDIA_PATH,
  public: "public",
  images: "images",
  assets: "assets",
} as const;

const IMAGE_UPLOAD_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

function flattenAssetTree(nodes: FileTreeNode[]): AssetItem[] {
  const files: AssetItem[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      files.push({
        name: node.name,
        type: "file",
        path: node.path,
        size: node.size,
        mimeType: node.mimeType,
        isImage: node.isImage,
      });
    } else if (node.children) {
      files.push(...flattenAssetTree(node.children));
    }
  }
  return files;
}

function flattenImageAssets(nodes?: FileTreeNode[]): AssetItem[] {
  return flattenAssetTree(nodes ?? []).filter(
    (item) => item.type === "file" && item.isImage,
  );
}

function mergeAssetItems(groups: AssetItem[][]): AssetItem[] {
  const byPath = new Map<string, AssetItem>();
  for (const group of groups) {
    for (const item of group) {
      if (!byPath.has(item.path)) {
        byPath.set(item.path, item);
      }
    }
  }
  return Array.from(byPath.values());
}

function isImageUploadFile(file: File): boolean {
  if (file.type.startsWith("image/")) {
    return true;
  }

  const extension = file.name
    .slice(file.name.lastIndexOf("."))
    .toLowerCase();
  return IMAGE_UPLOAD_EXTENSIONS.has(extension);
}

export function AssetExplorer({
  projectSlug,
  version,
  onClose,
}: AssetExplorerProps) {
  const { canUseAiImages } = usePermissions();
  const utils = trpc.useUtils();

  // View mode state - persisted to localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem("asset-explorer-view-mode");
    return stored === "gallery" || stored === "files" ? stored : "gallery";
  });

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("asset-explorer-view-mode", mode);
  };

  // Default asset location for uploads/generation; Files owns direct folder browsing.
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [initialPathDetected, setInitialPathDetected] = useState(false);

  // Folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderCreationPath, setFolderCreationPath] = useState<string | null>(
    null,
  );

  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "optimizing"
  >("idle");
  const [uploadTargetPath, setUploadTargetPath] = useState<string | null>(null);
  const [fileTreeRevealPath, setFileTreeRevealPath] = useState<string | null>(
    null,
  );
  const [fileTreeHighlightedPath, setFileTreeHighlightedPath] = useState<
    string | null
  >(null);

  // Image preview state (legacy dialog)
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageItem, setSelectedImageItem] = useState<
    AssetItem | FileTreeNode | null
  >(null);

  const [isCreateImageOpen, setIsCreateImageOpen] = useState(false);
  const [createImagePrompt, setCreateImagePrompt] = useState("");
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<
    string[]
  >([]);

  // Shared Asset Actions state from PreviewContext
  const {
    currentPreviewPath,
    setEditingAsset,
    setPendingDeleteAsset,
  } = usePreview();

  // Use optional chat context for "Add to chat" feature
  const chatContext = useOptionalChatContext();

  // Handler for adding file to chat
  const handleAddToChat = useCallback(
    (item: AssetItem | FileTreeNode) => {
      if (!chatContext) return;
      chatContext.addAttachedFile({
        path: item.path,
        filename: item.name,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      });
      toast.success(`Added ${item.name} to chat`);
    },
    [chatContext],
  );

  // Check both paths in parallel for initial detection
  const previewInfoQuery = trpc.project.getPreviewInfo.useQuery(
    { slug: projectSlug, version },
    { enabled: !initialPathDetected, staleTime: 0 },
  );
  const publicImagesCheck = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: "public/images" },
    { enabled: !initialPathDetected, staleTime: 0 },
  );
  const imagesCheck = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: "images" },
    { enabled: !initialPathDetected, staleTime: 0 },
  );
  const isAstroProject = previewInfoQuery.data?.mode === "devserver";
  const publicImagesHasItems = !!publicImagesCheck.data?.items?.length;
  const imagesHasItems = !!imagesCheck.data?.items?.length;
  const fallbackGalleryPath = pickInitialAssetExplorerPath({
    isAstroProject: Boolean(isAstroProject),
    uploadsHasItems: false,
    publicImagesHasItems,
    imagesHasItems,
  });
  const assetCreationTargetPath = pickAssetCreationTargetPath({
    isAstroProject: Boolean(isAstroProject),
    currentPath,
    fallbackGalleryPath,
  });
  const mediaLibraryCreationTargetPath = isAstroProject
    ? ASTRO_SHARED_MEDIA_PATH
    : assetCreationTargetPath;
  const activeAssetCreationTargetPath =
    viewMode === "gallery"
      ? mediaLibraryCreationTargetPath
      : assetCreationTargetPath;
  const activeAssetCreationTargetLabel =
    viewMode === "gallery" ? "media library" : activeAssetCreationTargetPath;

  // Detect initial path
  useEffect(() => {
    if (initialPathDetected) return;

    if (!previewInfoQuery.isFetched) {
      return;
    }

    if (
      !isAstroProject &&
      (!publicImagesCheck.isFetched || !imagesCheck.isFetched)
    ) {
      return;
    }

    setCurrentPath(fallbackGalleryPath);
    setInitialPathDetected(true);
  }, [
    previewInfoQuery.isFetched,
    isAstroProject,
    publicImagesCheck.isFetched,
    imagesCheck.isFetched,
    fallbackGalleryPath,
    initialPathDetected,
  ]);

  const shouldLoadMediaLibrary =
    initialPathDetected && (viewMode === "gallery" || isCreateImageOpen);
  const managedMediaQuery = trpc.assets.listAllAssets.useQuery(
    {
      slug: projectSlug,
      version,
      rootPath: MEDIA_LIBRARY_ROOTS.managed,
    },
    {
      enabled: shouldLoadMediaLibrary,
      staleTime: 0,
    },
  );
  const publicMediaQuery = trpc.assets.listAllAssets.useQuery(
    {
      slug: projectSlug,
      version,
      rootPath: MEDIA_LIBRARY_ROOTS.public,
    },
    {
      enabled: shouldLoadMediaLibrary,
      staleTime: 0,
    },
  );
  const legacyImagesQuery = trpc.assets.listAllAssets.useQuery(
    {
      slug: projectSlug,
      version,
      rootPath: MEDIA_LIBRARY_ROOTS.images,
    },
    {
      enabled: shouldLoadMediaLibrary,
      staleTime: 0,
    },
  );
  const legacyAssetsQuery = trpc.assets.listAllAssets.useQuery(
    {
      slug: projectSlug,
      version,
      rootPath: MEDIA_LIBRARY_ROOTS.assets,
    },
    {
      enabled: shouldLoadMediaLibrary,
      staleTime: 0,
    },
  );

  const lastPreviewPathRef = useRef(currentPreviewPath);

  useEffect(() => {
    if (lastPreviewPathRef.current === currentPreviewPath) {
      return;
    }

    lastPreviewPathRef.current = currentPreviewPath;
    void utils.assets.invalidate();
  }, [currentPreviewPath, utils.assets]);

  const mediaLibraryItems = mergeAssetItems([
    flattenImageAssets(managedMediaQuery.data?.tree),
    flattenImageAssets(publicMediaQuery.data?.tree),
    flattenImageAssets(legacyImagesQuery.data?.tree),
    flattenImageAssets(legacyAssetsQuery.data?.tree),
  ]);
  const isMediaLibraryLoading =
    managedMediaQuery.isLoading ||
    publicMediaQuery.isLoading ||
    legacyImagesQuery.isLoading ||
    legacyAssetsQuery.isLoading;
  const refetchMediaLibrary = () => {
    void managedMediaQuery.refetch();
    void publicMediaQuery.refetch();
    void legacyImagesQuery.refetch();
    void legacyAssetsQuery.refetch();
  };
  const availableImages = mediaLibraryItems;

  // Mutations
  const createFolderMutation = trpc.assets.createFolder.useMutation({
    onSuccess: () => {
      setIsCreatingFolder(false);
      setNewFolderName("");
      setFolderCreationPath(null);
      utils.assets.invalidate();
      toast.success("Folder created");
    },
    onError: (error) => {
      toast.error("Failed to create folder", { description: error.message });
    },
  });

  const createImageMutation = trpc.assets.createImageWithAI.useMutation({
    onSuccess: (data) => {
      const generatedDir =
        data.path.split("/").slice(0, -1).join("/") || fallbackGalleryPath;
      setIsCreateImageOpen(false);
      setCreateImagePrompt("");
      setSelectedReferenceImages([]);
      setCurrentPath(generatedDir);
      setFileTreeRevealPath(data.path);
      setFileTreeHighlightedPath(data.path);
      refetchMediaLibrary();
      utils.assets.invalidate();
      setSelectedImageUrl(buildImageUrl(projectSlug, version, data.path));
      toast.success("Image generated successfully");
    },
    onError: (error) => {
      toast.error("Failed to create image", { description: error.message });
    },
  });

  const handleUpload = async (
    files: FileList | File[],
    targetPath: string = STUDIO_UPLOADS_PATH,
    options: { imagesOnly?: boolean } = {},
  ) => {
    if (!files.length) return;
    const uploadFiles = options.imagesOnly
      ? Array.from(files).filter(isImageUploadFile)
      : Array.from(files);

    if (!uploadFiles.length) {
      toast.error("Gallery only accepts images", {
        description: "Use Files for PDFs, code, and other project files.",
      });
      return;
    }

    setUploadTargetPath(targetPath);
    setUploadStatus(
      shouldShowWorkingImageOptimization(uploadFiles, targetPath)
        ? "optimizing"
        : "uploading",
    );

    try {
      const uploadedPaths = await uploadFilesToStudioPath({
        projectSlug,
        version,
        targetPath,
        files: uploadFiles,
      });
      const firstUploadedPath = uploadedPaths[0] ?? null;

      setCurrentPath(targetPath);
      setFileTreeRevealPath(firstUploadedPath ?? targetPath);
      setFileTreeHighlightedPath(firstUploadedPath);
      refetchMediaLibrary();
      utils.assets.invalidate();
      toast.success("Upload successful", {
        description: `Saved to ${
          options.imagesOnly ? "media library" : targetPath
        }`,
      });
      if (options.imagesOnly && uploadFiles.length < files.length) {
        toast.info("Skipped non-image files", {
          description: "Use Files to upload non-image assets.",
        });
      }
    } catch (error) {
      toast.error("Upload failed", { description: (error as Error).message });
    } finally {
      setUploadStatus("idle");
      setUploadTargetPath(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    const isExternalFileDrag =
      e.dataTransfer.types.includes("Files") &&
      !e.dataTransfer.types.includes("application/x-file-path");
    if (!isExternalFileDrag) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    const isExternalFileDrop =
      e.dataTransfer.types.includes("Files") &&
      !e.dataTransfer.types.includes("application/x-file-path");
    if (!isExternalFileDrop) {
      return;
    }

    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files, activeAssetCreationTargetPath, {
        imagesOnly: viewMode === "gallery",
      });
    }
  };

  const handleCreateFolder = (path: string) => {
    setFolderCreationPath(path);
    setIsCreatingFolder(true);
  };

  const onSubmitFolder = () => {
    if (!newFolderName.trim() || !folderCreationPath) return;
    createFolderMutation.mutate({
      slug: projectSlug,
      version,
      relativePath: folderCreationPath,
      folderName: newFolderName.trim(),
    });
  };

  const handleCreateImage = () => {
    if (!createImagePrompt.trim()) return;

    createImageMutation.mutate({
      slug: projectSlug,
      version,
      prompt: createImagePrompt.trim(),
      referenceImages: selectedReferenceImages,
      targetPath: activeAssetCreationTargetPath,
    });
  };

  const toggleReferenceImage = (path: string) => {
    setSelectedReferenceImages((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  const handleDelete = (item: AssetItem | FileTreeNode) => {
    setPendingDeleteAsset(item);
  };

  const handleAiEdit = (item: AssetItem | FileTreeNode) => {
    setEditingAsset(item);
  };

  const uploadStatusTargetLabel =
    viewMode === "gallery" && uploadTargetPath === activeAssetCreationTargetPath
      ? activeAssetCreationTargetLabel
      : (uploadTargetPath ?? "");

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          Assets
        </h3>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={handleViewModeChange} />
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <AssetToolbar
        currentPath={viewMode === "files" ? (currentPath ?? "") : undefined}
        uploadTargetPath={activeAssetCreationTargetPath}
        uploadTargetLabel={activeAssetCreationTargetLabel}
        fileInputAccept={viewMode === "gallery" ? "image/*" : undefined}
        onFilesSelected={(files) =>
          handleUpload(files, activeAssetCreationTargetPath, {
            imagesOnly: viewMode === "gallery",
          })
        }
        onRefresh={() => {
          refetchMediaLibrary();
          utils.assets.invalidate();
        }}
        onCreateFolder={
          viewMode === "files"
            ? () => handleCreateFolder(currentPath ?? fallbackGalleryPath)
            : undefined
        }
        onCreateImage={
          canUseAiImages ? () => setIsCreateImageOpen(true) : undefined
        }
        uploadStatus={uploadStatus}
      />

      {uploadStatus !== "idle" && uploadTargetPath && (
        <div className="flex items-center gap-3 border-b bg-primary/5 px-4 py-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {uploadStatus === "optimizing"
                ? "Uploading and optimizing working images"
                : "Uploading files"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {uploadStatus === "optimizing"
                ? `Saving to ${uploadStatusTargetLabel} as WebP working assets when possible`
                : `Saving to ${uploadStatusTargetLabel}`}
            </p>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        {isCreatingFolder && (
          <div className="px-4 py-2 border-b">
            <CreateFolderInput
              value={newFolderName}
              onChange={setNewFolderName}
              onSubmit={onSubmitFolder}
              onCancel={() => setIsCreatingFolder(false)}
              isPending={createFolderMutation.isPending}
            />
          </div>
        )}

        {viewMode === "files" ? (
          <FileTreeView
            projectSlug={projectSlug}
            version={version}
            revealPath={fileTreeRevealPath}
            highlightedPath={fileTreeHighlightedPath}
            onRevealHandled={() => setFileTreeRevealPath(null)}
            onAiEdit={
              canUseAiImages
                ? (handleAiEdit as (item: FileTreeNode) => void)
                : undefined
            }
            onDelete={handleDelete as (item: FileTreeNode) => void}
            onAddToChat={handleAddToChat as (item: FileTreeNode) => void}
            onCreateFolder={handleCreateFolder}
            onFilesUpload={handleUpload}
            onRefetch={() => {
              refetchMediaLibrary();
              utils.assets.invalidate();
            }}
          />
        ) : (
          <ImageGalleryView
            projectSlug={projectSlug}
            version={version}
            currentPath={currentPath ?? ""}
            itemsOverride={mediaLibraryItems}
            isLoadingOverride={isMediaLibraryLoading}
            emptyLabel="No images yet"
            onAiEdit={
              canUseAiImages
                ? (handleAiEdit as (item: AssetItem) => void)
                : undefined
            }
            onDelete={handleDelete as (item: AssetItem) => void}
            onAddToChat={handleAddToChat as (item: AssetItem) => void}
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        )}
      </ScrollArea>

      {/* Action footer area */}
      <div className="p-4 border-t bg-muted/20">
        <div className="flex flex-col gap-2">
          {canUseAiImages && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 justify-start"
              onClick={() => setIsCreateImageOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Generate Image
            </Button>
          )}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            <span>Project Assets</span>
            <div className="flex items-center gap-1.5">
              <ImageIcon className="h-3 w-3" />
              <span>
                {projectSlug} v{version}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Legacy Preview Dialog */}
      <ImagePreviewDialog
        open={!!selectedImageUrl}
        imageUrl={selectedImageUrl}
        imageItem={selectedImageItem as AssetItem | null}
        onClose={() => {
          setSelectedImageUrl(null);
          setSelectedImageItem(null);
        }}
        onAiEdit={
          canUseAiImages && selectedImageItem
            ? () => handleAiEdit(selectedImageItem)
            : undefined
        }
        onDelete={() => selectedImageItem && handleDelete(selectedImageItem)}
        onDownload={() => {
          if (selectedImageUrl && selectedImageItem) {
            const link = document.createElement("a");
            link.href = selectedImageUrl;
            link.download = selectedImageItem.name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
        }}
      />

      {/* Create Image Dialog */}
      <CreateImageDialog
        open={isCreateImageOpen}
        prompt={createImagePrompt}
        onPromptChange={setCreateImagePrompt}
        selectedReferenceImages={selectedReferenceImages}
        onToggleReferenceImage={toggleReferenceImage}
        availableImages={availableImages}
        isLoadingImages={isMediaLibraryLoading}
        onClose={() => {
          setIsCreateImageOpen(false);
          setCreateImagePrompt("");
          setSelectedReferenceImages([]);
        }}
        onSubmit={handleCreateImage}
        isPending={createImageMutation.isPending}
        projectSlug={projectSlug}
        version={version}
      />
    </div>
  );
}
