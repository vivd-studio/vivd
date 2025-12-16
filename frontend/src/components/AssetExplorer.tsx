import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  Folder,
  FolderPlus,
  Upload,
  Trash2,
  ChevronLeft,
  Image as ImageIcon,
  FileText,
  File,
  Loader2,
  Wand2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface AssetExplorerProps {
  projectSlug: string;
  version: number;
  onClose?: () => void;
}

interface AssetItem {
  name: string;
  type: "file" | "folder";
  path: string;
  size?: number;
  mimeType?: string;
  isImage?: boolean;
}

export function AssetExplorer({
  projectSlug,
  version,
  onClose,
}: AssetExplorerProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageItem, setSelectedImageItem] = useState<AssetItem | null>(
    null
  );
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refetch } = trpc.assets.listAssets.useQuery({
    slug: projectSlug,
    version,
    relativePath: currentPath,
  });

  const deleteMutation = trpc.assets.deleteAsset.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const createFolderMutation = trpc.assets.createFolder.useMutation({
    onSuccess: () => {
      setIsCreatingFolder(false);
      setNewFolderName("");
      refetch();
    },
  });

  // AI Edit state
  const [editingImage, setEditingImage] = useState<AssetItem | null>(null);
  const [editPrompt, setEditPrompt] = useState("");

  const editImageMutation = trpc.assets.editImageWithAI.useMutation({
    onSuccess: (data) => {
      setEditingImage(null);
      setEditPrompt("");
      refetch();
      // Show the newly generated image in the preview modal
      setSelectedImage(
        `/api/generated/${projectSlug}/v${version}/${data.newPath}`
      );
    },
    onError: (error) => {
      alert(`Failed to edit image: ${error.message}`);
    },
  });

  const [isUploading, setIsUploading] = useState(false);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
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

  const handleItemClick = (item: AssetItem) => {
    if (item.type === "folder") {
      setCurrentPath(item.path);
    } else if (item.isImage) {
      setSelectedImage(
        `/api/generated/${projectSlug}/v${version}/${item.path}`
      );
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

  const handleBack = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join("/"));
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

  const getFileIcon = (item: AssetItem) => {
    if (item.type === "folder") {
      return <Folder className="w-8 h-8 text-amber-500" />;
    }
    if (item.isImage) {
      return <ImageIcon className="w-8 h-8 text-blue-500" />;
    }
    if (item.mimeType?.includes("pdf")) {
      return <FileText className="w-8 h-8 text-red-500" />;
    }
    return <File className="w-8 h-8 text-gray-500" />;
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pathParts = currentPath.split("/").filter(Boolean);

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
      <div className="px-2 py-2 border-b flex flex-wrap items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleBack}
          disabled={!currentPath}
          title="Go back"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-xs text-muted-foreground flex-1 min-w-0 truncate px-1">
          /{pathParts.join("/")}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsCreatingFolder(true)}
            title="New Folder"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title="Upload files"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Create Folder Input */}
      {isCreatingFolder && (
        <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
          <Input
            placeholder="Folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
            autoFocus
          />
          <Button
            size="sm"
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || createFolderMutation.isPending}
          >
            Create
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsCreatingFolder(false);
              setNewFolderName("");
            }}
          >
            Cancel
          </Button>
        </div>
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
                <div
                  key={item.path}
                  onClick={() => handleItemClick(item)}
                  className="relative group p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <div className="flex flex-col items-center gap-2">
                    {item.type === "file" && item.isImage ? (
                      <div className="w-16 h-16 rounded overflow-hidden bg-muted flex items-center justify-center">
                        <img
                          src={`/api/generated/${projectSlug}/v${version}/${item.path}`}
                          alt={item.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 flex items-center justify-center">
                        {getFileIcon(item)}
                      </div>
                    )}
                    <div className="text-center w-full">
                      <p className="text-sm font-medium truncate w-full">
                        {item.name}
                      </p>
                      {item.type === "file" && item.size !== undefined && (
                        <p className="text-xs text-muted-foreground">
                          {formatSize(item.size)}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Action buttons */}
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* AI Edit button - only for images */}
                    {item.type === "file" && item.isImage && (
                      <Button
                        variant="secondary"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => handleAiEdit(item, e)}
                        title="Edit with AI"
                      >
                        <Wand2 className="h-3 w-3" />
                      </Button>
                    )}
                    {/* Delete button */}
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => handleDelete(item, e)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Image Preview Modal */}
      <Dialog
        open={!!selectedImage}
        onOpenChange={() => {
          setSelectedImage(null);
          setSelectedImageItem(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle className="flex-1">
              {selectedImageItem?.name || "Image Preview"}
            </DialogTitle>
            {selectedImageItem && (
              <div className="flex gap-2 mr-8">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (selectedImageItem) {
                      setEditingImage(selectedImageItem);
                      setEditPrompt("");
                      setSelectedImage(null);
                      setSelectedImageItem(null);
                    }
                  }}
                  title="Edit with AI"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  AI Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (
                      selectedImageItem &&
                      confirm(`Delete "${selectedImageItem.name}"?`)
                    ) {
                      deleteMutation.mutate({
                        slug: projectSlug,
                        version,
                        relativePath: selectedImageItem.path,
                      });
                      setSelectedImage(null);
                      setSelectedImageItem(null);
                    }
                  }}
                  title="Delete image"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            )}
          </DialogHeader>
          {selectedImage && (
            <div className="flex items-center justify-center p-4">
              <img
                src={selectedImage}
                alt="Preview"
                className="max-w-full max-h-[70vh] object-contain rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* AI Edit Dialog */}
      <Dialog
        open={!!editingImage}
        onOpenChange={(open) => {
          if (!open) {
            setEditingImage(null);
            setEditPrompt("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Image with AI</DialogTitle>
          </DialogHeader>
          {editingImage && (
            <div className="space-y-4">
              <div className="flex items-center justify-center bg-muted rounded-lg p-2">
                <img
                  src={`/api/generated/${projectSlug}/v${version}/${editingImage.path}`}
                  alt={editingImage.name}
                  className="max-w-full max-h-48 object-contain rounded"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  What would you like to change?
                </label>
                <Textarea
                  placeholder="e.g., Make the background blue, add a sunset, remove the text..."
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingImage(null);
                    setEditPrompt("");
                  }}
                  disabled={editImageMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitAiEdit}
                  disabled={!editPrompt.trim() || editImageMutation.isPending}
                >
                  {editImageMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Generate
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
