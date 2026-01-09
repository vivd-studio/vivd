import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
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

import type { AssetItem, ViewMode, FileTreeNode } from "./types";
import { buildImageUrl } from "./utils";
import { AssetToolbar } from "./AssetToolbar";
import { CreateFolderInput } from "./CreateFolderInput";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { AIEditDialog } from "./AIEditDialog";
import { CreateImageDialog } from "./CreateImageDialog";
import { ViewModeToggle } from "./ViewModeToggle";
import { ImageGalleryView } from "./ImageGalleryView";
import { FileTreeView } from "./FileTreeView";
import { usePermissions } from "@/hooks/usePermissions";
import { usePreview } from "@/components/preview/PreviewContext";

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

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>("gallery");

  // Navigation state (for gallery mode) - will be initialized based on folder detection
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [initialPathDetected, setInitialPathDetected] = useState(false);

  // Folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Image preview state
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageItem, setSelectedImageItem] = useState<
    AssetItem | FileTreeNode | null
  >(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<
    AssetItem | FileTreeNode | null
  >(null);

  // AI Edit state
  const [editingImage, setEditingImage] = useState<
    AssetItem | FileTreeNode | null
  >(null);
  const [editPrompt, setEditPrompt] = useState("");

  // Create Image state
  const [isCreateImageOpen, setIsCreateImageOpen] = useState(false);
  const [createImagePrompt, setCreateImagePrompt] = useState("");
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<
    string[]
  >([]);

  // Use context for text editor (rendered in PreviewContent)
  const { setEditingTextFile } = usePreview();

  // Check for public/images first, then fall back to images
  const publicImagesCheck = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: "public/images" },
    { enabled: !initialPathDetected }
  );
  const imagesCheck = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: "images" },
    { enabled: !initialPathDetected && publicImagesCheck.isFetched }
  );

  // Detect initial path
  useEffect(() => {
    if (initialPathDetected) return;

    // Check public/images first
    if (publicImagesCheck.isFetched) {
      if (
        publicImagesCheck.data?.items &&
        publicImagesCheck.data.items.length > 0
      ) {
        setCurrentPath("public/images");
        setInitialPathDetected(true);
        return;
      }

      // Then check images
      if (imagesCheck.isFetched) {
        // Use images even if empty (it's the fallback)
        setCurrentPath("images");
        setInitialPathDetected(true);
      }
    }
  }, [
    publicImagesCheck.isFetched,
    publicImagesCheck.data,
    imagesCheck.isFetched,
    initialPathDetected,
  ]);

  // Query for gallery mode list
  const galleryQuery = trpc.assets.listAssets.useQuery(
    {
      slug: projectSlug,
      version,
      relativePath: currentPath ?? "images",
    },
    { enabled: viewMode === "gallery" && currentPath !== null }
  );

  // Query for create image dialog
  const allImagesQuery = trpc.assets.listAssets.useQuery(
    { slug: projectSlug, version, relativePath: "images" },
    { enabled: isCreateImageOpen }
  );

  const availableImages =
    allImagesQuery.data?.items?.filter(
      (item) => item.type === "file" && item.isImage
    ) || [];

  // Mutations
  const deleteMutation = trpc.assets.deleteAsset.useMutation({
    onSuccess: () => {
      toast.success("Asset deleted");
      // Invalidate all asset queries to refresh both gallery and explorer views
      utils.assets.invalidate();
    },
    onError: (error) => {
      toast.error("Failed to delete asset", { description: error.message });
    },
  });

  const createFolderMutation = trpc.assets.createFolder.useMutation({
    onSuccess: () => {
      setIsCreatingFolder(false);
      setNewFolderName("");
      galleryQuery.refetch();
    },
  });

  const editImageMutation = trpc.assets.editImageWithAI.useMutation({
    onSuccess: (data) => {
      setEditingImage(null);
      setEditPrompt("");
      galleryQuery.refetch();
      setSelectedImageUrl(buildImageUrl(projectSlug, version, data.newPath));
    },
    onError: (error) => {
      toast.error("Failed to edit image", { description: error.message });
    },
  });

  const createImageMutation = trpc.assets.createImageWithAI.useMutation({
    onSuccess: (data) => {
      setIsCreateImageOpen(false);
      setCreateImagePrompt("");
      setSelectedReferenceImages([]);
      galleryQuery.refetch();
      setSelectedImageUrl(buildImageUrl(projectSlug, version, data.path));
    },
    onError: (error) => {
      toast.error("Failed to create image", { description: error.message });
    },
  });

  // Handlers
  const handleBack = () => {
    if (!currentPath) return; // Already at root or no path set
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    // Navigate to parent, or stay at empty string for root
    setCurrentPath(parts.join("/"));
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
  };

  const handleImagePreview = (url: string, item: AssetItem | FileTreeNode) => {
    setSelectedImageUrl(url);
    setSelectedImageItem(item);
  };

  const handleDelete = (item: AssetItem | FileTreeNode) => {
    setPendingDeleteItem(item);
  };

  const confirmDelete = () => {
    if (!pendingDeleteItem) return;
    const deletedPath = pendingDeleteItem.path;
    deleteMutation.mutate({
      slug: projectSlug,
      version,
      relativePath: deletedPath,
    });
    setPendingDeleteItem(null);
    if (selectedImageItem?.path === deletedPath) {
      setSelectedImageUrl(null);
      setSelectedImageItem(null);
    }
  };

  const handleAiEdit = (item: AssetItem | FileTreeNode) => {
    setEditingImage(item);
    setEditPrompt("");
  };

  const handleSubmitAiEdit = () => {
    if (!editingImage || !editPrompt.trim()) return;
    editImageMutation.mutate({
      slug: projectSlug,
      version,
      relativePath: editingImage.path,
      prompt: editPrompt.trim(),
    });
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolderMutation.mutate({
        slug: projectSlug,
        version,
        relativePath: viewMode === "gallery" ? currentPath ?? "" : "",
        folderName: newFolderName.trim(),
      });
    }
  };

  const handleCreateImage = () => {
    if (!createImagePrompt.trim()) return;
    createImageMutation.mutate({
      slug: projectSlug,
      version,
      prompt: createImagePrompt.trim(),
      referenceImages: selectedReferenceImages,
      targetPath: viewMode === "gallery" ? currentPath ?? "" : "images",
    });
  };

  const toggleReferenceImage = (path: string) => {
    setSelectedReferenceImages((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  // Download handler for explorer view
  const handleDownloadFile = (item: AssetItem | FileTreeNode) => {
    const url = buildImageUrl(projectSlug, version, item.path);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // File upload handlers
  const uploadFiles = async (files: FileList | File[], targetPath?: string) => {
    setIsUploading(true);
    const uploadPath =
      targetPath ?? (viewMode === "gallery" ? currentPath ?? "" : "images");
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(
        `/vivd-studio/api/upload/${projectSlug}/${version}?path=${encodeURIComponent(
          uploadPath
        )}`,
        {
          method: "POST",
          body: formData,
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      galleryQuery.refetch();
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload files");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFiles(e.dataTransfer.files);
      }
    },
    [currentPath, viewMode]
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Assets</h2>
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Toolbar - only shown in gallery mode */}
      {viewMode === "gallery" && (
        <AssetToolbar
          currentPath={currentPath ?? ""}
          isUploading={isUploading}
          onBack={handleBack}
          onCreateFolder={() => setIsCreatingFolder(true)}
          onCreateImage={
            canUseAiImages
              ? () => {
                  setIsCreateImageOpen(true);
                  setCreateImagePrompt("");
                  setSelectedReferenceImages([]);
                }
              : undefined
          }
          onFilesSelected={uploadFiles}
        />
      )}

      {/* Toolbar for files mode (no navigation, just action buttons) */}
      {viewMode === "files" && (
        <AssetToolbar
          isUploading={isUploading}
          onCreateFolder={() => setIsCreatingFolder(true)}
          onCreateImage={
            canUseAiImages
              ? () => {
                  setIsCreateImageOpen(true);
                  setCreateImagePrompt("");
                  setSelectedReferenceImages([]);
                }
              : undefined
          }
          onFilesSelected={uploadFiles}
        />
      )}

      {/* Create Folder Input */}
      {isCreatingFolder && (
        <CreateFolderInput
          value={newFolderName}
          onChange={setNewFolderName}
          onSubmit={handleCreateFolder}
          onCancel={() => {
            setIsCreatingFolder(false);
            setNewFolderName("");
          }}
          isPending={createFolderMutation.isPending}
        />
      )}

      {/* Main Content Area */}
      <ScrollArea className="flex-1">
        {viewMode === "gallery" ? (
          <ImageGalleryView
            projectSlug={projectSlug}
            version={version}
            currentPath={currentPath ?? ""}
            onNavigate={handleNavigate}
            onImagePreview={handleImagePreview}
            onAiEdit={canUseAiImages ? handleAiEdit : undefined}
            onDelete={handleDelete}
            onTextEdit={setEditingTextFile}
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        ) : (
          <FileTreeView
            projectSlug={projectSlug}
            version={version}
            onImagePreview={handleImagePreview}
            onRefetch={() => galleryQuery.refetch()}
            onFilesUpload={uploadFiles}
            onDelete={handleDelete}
            onDownload={handleDownloadFile}
            onAiEdit={canUseAiImages ? handleAiEdit : undefined}
          />
        )}
      </ScrollArea>

      {/* Image Preview Dialog */}
      <ImagePreviewDialog
        open={!!selectedImageUrl}
        imageUrl={selectedImageUrl}
        imageItem={selectedImageItem as AssetItem | null}
        onClose={() => {
          setSelectedImageUrl(null);
          setSelectedImageItem(null);
        }}
        onAiEdit={
          canUseAiImages
            ? () => {
                if (selectedImageItem) {
                  setEditingImage(selectedImageItem);
                  setEditPrompt("");
                  setSelectedImageUrl(null);
                  setSelectedImageItem(null);
                }
              }
            : undefined
        }
        onDelete={() => {
          if (selectedImageItem) {
            setPendingDeleteItem(selectedImageItem);
          }
        }}
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

      {/* AI Edit Dialog */}
      <AIEditDialog
        open={!!editingImage}
        editingImage={editingImage as AssetItem | null}
        prompt={editPrompt}
        onPromptChange={setEditPrompt}
        onClose={() => {
          setEditingImage(null);
          setEditPrompt("");
        }}
        onSubmit={handleSubmitAiEdit}
        isPending={editImageMutation.isPending}
        projectSlug={projectSlug}
        version={version}
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

      <AlertDialog
        open={!!pendingDeleteItem}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteItem(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteItem ? (
                <>
                  Delete <code>{pendingDeleteItem.name}</code>? This cannot be
                  undone.
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
              onClick={confirmDelete}
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
    </div>
  );
}
