import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Plus, ImageIcon } from "lucide-react";
import { toast } from "sonner";

import type { AssetItem, ViewMode, FileTreeNode } from "./types";
import { buildImageUrl } from "./utils";
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

  // Navigation state (for gallery mode) - will be initialized based on folder detection
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

  // Image preview state (legacy dialog)
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageItem, setSelectedImageItem] = useState<
    AssetItem | FileTreeNode | null
  >(null);

  // Shared Asset Actions state from PreviewContext
  const { setEditingTextFile, setEditingAsset, setPendingDeleteAsset } =
    usePreview();

  const [isCreateImageOpen, setIsCreateImageOpen] = useState(false);
  const [createImagePrompt, setCreateImagePrompt] = useState("");
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<
    string[]
  >([]);

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
  const publicImagesCheck = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: "public/images" },
    { enabled: !initialPathDetected },
  );
  const imagesCheck = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: "images" },
    { enabled: !initialPathDetected },
  );

  // Detect initial path
  useEffect(() => {
    if (initialPathDetected) return;

    // Wait for both queries to complete
    if (!publicImagesCheck.isFetched || !imagesCheck.isFetched) return;

    const publicHasItems =
      publicImagesCheck.data?.items && publicImagesCheck.data.items.length > 0;
    const imagesHasItems =
      imagesCheck.data?.items && imagesCheck.data.items.length > 0;

    // Prefer public/images if it has items, or if both are empty (it's the standard location)
    // Only use "images" if it has items and public/images is empty
    if (publicHasItems || !imagesHasItems) {
      setCurrentPath("public/images");
    } else {
      setCurrentPath("images");
    }
    setInitialPathDetected(true);
  }, [
    publicImagesCheck.isFetched,
    publicImagesCheck.data,
    imagesCheck.isFetched,
    imagesCheck.data,
    initialPathDetected,
  ]);

  // Query for gallery mode list
  const galleryQuery = trpc.assets.listAssets.useQuery(
    {
      slug: projectSlug,
      version,
      relativePath: currentPath ?? "images",
    },
    { enabled: viewMode === "gallery" && currentPath !== null },
  );

  // Query for create image dialog - use detected path (public/images for Astro, images for HTML)
  const allImagesQuery = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: currentPath ?? "images" },
    { enabled: isCreateImageOpen && currentPath !== null },
  );

  const availableImages =
    allImagesQuery.data?.items?.filter(
      (item) => item.type === "file" && item.isImage,
    ) || [];

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
      setIsCreateImageOpen(false);
      setCreateImagePrompt("");
      setSelectedReferenceImages([]);
      galleryQuery.refetch();
      utils.assets.invalidate();
      setSelectedImageUrl(buildImageUrl(projectSlug, version, data.path));
      toast.success("Image generated successfully");
    },
    onError: (error) => {
      toast.error("Failed to create image", { description: error.message });
    },
  });

  const handleUpload = async (files: FileList) => {
    if (!files.length || !currentPath) return;

    setUploadStatus("uploading");

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }

      const response = await fetch(
        `/vivd-studio/api/upload/${projectSlug}/${version}?path=${encodeURIComponent(currentPath)}`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      setUploadStatus("idle");
      galleryQuery.refetch();
      utils.assets.invalidate();
      toast.success("Upload successful");
    } catch (error) {
      setUploadStatus("idle");
      toast.error("Upload failed", { description: (error as Error).message });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleUpload(e.dataTransfer.files);
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
      targetPath: currentPath ?? "images",
    });
  };

  const toggleReferenceImage = (path: string) => {
    setSelectedReferenceImages((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
  };

  const handleDelete = (item: AssetItem | FileTreeNode) => {
    setPendingDeleteAsset(item);
  };

  const handleAiEdit = (item: AssetItem | FileTreeNode) => {
    setEditingAsset(item);
  };

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
        currentPath={currentPath ?? ""}
        onFilesSelected={handleUpload}
        onRefresh={() => {
          galleryQuery.refetch();
          utils.assets.invalidate();
        }}
        onBack={
          currentPath &&
          currentPath !== "images" &&
          currentPath !== "public/images"
            ? () => {
                const parts = currentPath.split("/");
                parts.pop();
                setCurrentPath(parts.join("/"));
              }
            : undefined
        }
        onCreateFolder={() => handleCreateFolder(currentPath ?? "images")}
        onCreateImage={
          canUseAiImages ? () => setIsCreateImageOpen(true) : undefined
        }
        uploadStatus={uploadStatus}
      />

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
            onAiEdit={
              canUseAiImages
                ? (handleAiEdit as (item: FileTreeNode) => void)
                : undefined
            }
            onDelete={handleDelete as (item: FileTreeNode) => void}
            onAddToChat={handleAddToChat as (item: FileTreeNode) => void}
            onCreateFolder={handleCreateFolder}
            onRefetch={() => {
              galleryQuery.refetch();
              utils.assets.invalidate();
            }}
          />
        ) : (
          <ImageGalleryView
            projectSlug={projectSlug}
            version={version}
            currentPath={currentPath ?? ""}
            onNavigate={handleNavigate}
            onAiEdit={
              canUseAiImages
                ? (handleAiEdit as (item: AssetItem) => void)
                : undefined
            }
            onDelete={handleDelete as (item: AssetItem) => void}
            onTextEdit={(path) => setEditingTextFile(path)}
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
        isLoadingImages={allImagesQuery.isLoading}
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
