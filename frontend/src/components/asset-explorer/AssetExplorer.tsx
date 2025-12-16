import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Loader2 } from "lucide-react";

import type { AssetItem } from "./types";
import { buildImageUrl } from "./utils";
import { AssetItemCard } from "./AssetItemCard";
import { AssetToolbar } from "./AssetToolbar";
import { CreateFolderInput } from "./CreateFolderInput";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { AIEditDialog } from "./AIEditDialog";
import { CreateImageDialog } from "./CreateImageDialog";

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
  // Navigation state
  const [currentPath, setCurrentPath] = useState("");

  // Folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Image preview state
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageItem, setSelectedImageItem] = useState<AssetItem | null>(
    null
  );

  // AI Edit state
  const [editingImage, setEditingImage] = useState<AssetItem | null>(null);
  const [editPrompt, setEditPrompt] = useState("");

  // Create Image state
  const [isCreateImageOpen, setIsCreateImageOpen] = useState(false);
  const [createImagePrompt, setCreateImagePrompt] = useState("");
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<
    string[]
  >([]);

  // Queries
  const { data, isLoading, refetch } = trpc.assets.listAssets.useQuery({
    slug: projectSlug,
    version,
    relativePath: currentPath,
  });

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
    onSuccess: () => refetch(),
  });

  const createFolderMutation = trpc.assets.createFolder.useMutation({
    onSuccess: () => {
      setIsCreatingFolder(false);
      setNewFolderName("");
      refetch();
    },
  });

  const editImageMutation = trpc.assets.editImageWithAI.useMutation({
    onSuccess: (data) => {
      setEditingImage(null);
      setEditPrompt("");
      refetch();
      setSelectedImageUrl(buildImageUrl(projectSlug, version, data.newPath));
    },
    onError: (error) => {
      alert(`Failed to edit image: ${error.message}`);
    },
  });

  const createImageMutation = trpc.assets.createImageWithAI.useMutation({
    onSuccess: (data) => {
      setIsCreateImageOpen(false);
      setCreateImagePrompt("");
      setSelectedReferenceImages([]);
      refetch();
      setSelectedImageUrl(buildImageUrl(projectSlug, version, data.path));
    },
    onError: (error) => {
      alert(`Failed to create image: ${error.message}`);
    },
  });

  // Handlers
  const handleBack = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join("/"));
  };

  const handleItemClick = (item: AssetItem) => {
    if (item.type === "folder") {
      setCurrentPath(item.path);
    } else if (item.isImage) {
      setSelectedImageUrl(buildImageUrl(projectSlug, version, item.path));
      setSelectedImageItem(item);
    }
  };

  const handleDelete = (item: AssetItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete "${item.name}"?`)) {
      deleteMutation.mutate({
        slug: projectSlug,
        version,
        relativePath: item.path,
      });
    }
  };

  const handleAiEdit = (item: AssetItem, e: React.MouseEvent) => {
    e.stopPropagation();
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
        relativePath: currentPath,
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
      targetPath: currentPath,
    });
  };

  const toggleReferenceImage = (path: string) => {
    setSelectedReferenceImages((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  // File upload handlers
  const uploadFiles = async (files: FileList | File[]) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(
        `/api/upload/${projectSlug}/${version}?path=${encodeURIComponent(
          currentPath
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

      refetch();
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload files");
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
    [currentPath]
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Assets</h2>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <AssetToolbar
        currentPath={currentPath}
        isUploading={isUploading}
        onBack={handleBack}
        onCreateFolder={() => setIsCreatingFolder(true)}
        onCreateImage={() => {
          setIsCreateImageOpen(true);
          setCreateImagePrompt("");
          setSelectedReferenceImages([]);
        }}
        onFilesSelected={uploadFiles}
      />

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

      {/* File List */}
      <ScrollArea className="flex-1">
        <div
          className={`p-4 min-h-full ${
            isDragging ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items?.length ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <p>No files yet</p>
              <p className="text-sm">Drop files here or click Upload</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {data.items.map((item) => (
                <AssetItemCard
                  key={item.path}
                  item={item}
                  projectSlug={projectSlug}
                  version={version}
                  onClick={() => handleItemClick(item)}
                  onDelete={(e) => handleDelete(item, e)}
                  onAiEdit={
                    item.type === "file" && item.isImage
                      ? (e) => handleAiEdit(item, e)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Image Preview Dialog */}
      <ImagePreviewDialog
        open={!!selectedImageUrl}
        imageUrl={selectedImageUrl}
        imageItem={selectedImageItem}
        onClose={() => {
          setSelectedImageUrl(null);
          setSelectedImageItem(null);
        }}
        onAiEdit={() => {
          if (selectedImageItem) {
            setEditingImage(selectedImageItem);
            setEditPrompt("");
            setSelectedImageUrl(null);
            setSelectedImageItem(null);
          }
        }}
        onDelete={() => {
          if (
            selectedImageItem &&
            confirm(`Delete "${selectedImageItem.name}"?`)
          ) {
            deleteMutation.mutate({
              slug: projectSlug,
              version,
              relativePath: selectedImageItem.path,
            });
            setSelectedImageUrl(null);
            setSelectedImageItem(null);
          }
        }}
      />

      {/* AI Edit Dialog */}
      <AIEditDialog
        open={!!editingImage}
        editingImage={editingImage}
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
    </div>
  );
}
