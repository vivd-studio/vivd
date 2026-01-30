import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

import type { FileTreeNode } from "./types";
import { FileTreeItem } from "./FileTreeItem";
import { usePreview } from "@/components/preview/PreviewContext";

interface FileTreeViewProps {
  projectSlug: string;
  version: number;
  onRefetch?: () => void;
  onFilesUpload?: (files: FileList, targetPath: string) => Promise<void>;
  onDelete?: (item: FileTreeNode) => void;
  onDownload?: (item: FileTreeNode) => void;
  onAiEdit?: (item: FileTreeNode) => void;
  onCreateFolder?: (parentPath: string) => void;
  onAddToChat?: (item: FileTreeNode) => void;
}

export function FileTreeView({
  projectSlug,
  version,
  onRefetch,
  onFilesUpload,
  onDelete,
  onDownload,
  onAiEdit,
  onCreateFolder,
  onAddToChat,
}: FileTreeViewProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [rootDragOver, setRootDragOver] = useState(false);
  const [isExternalDrag, setIsExternalDrag] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const { setEditingTextFile, setViewingImagePath, viewingImagePath } = usePreview();

  // Global dragend listener to clean up state when drag is cancelled
  useEffect(() => {
    const handleDragEnd = () => {
      setRootDragOver(false);
    };
    document.addEventListener("dragend", handleDragEnd);
    return () => document.removeEventListener("dragend", handleDragEnd);
  }, []);

  const { data, isLoading, refetch } = trpc.assets.listAllAssets.useQuery({
    slug: projectSlug,
    version,
    rootPath: "",
  });

  const moveMutation = trpc.assets.moveAsset.useMutation({
    onSuccess: () => {
      toast.success("File moved successfully");
      refetch();
      onRefetch?.();
    },
    onError: (error) => {
      toast.error("Failed to move file", { description: error.message });
    },
  });

  const renameMutation = trpc.assets.moveAsset.useMutation({
    onSuccess: () => {
      toast.success("Renamed successfully");
      setRenamingPath(null);
      refetch();
      onRefetch?.();
    },
    onError: (error) => {
      toast.error("Failed to rename", { description: error.message });
      setRenamingPath(null);
    },
  });

  const toggleExpanded = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleItemClick = (item: FileTreeNode) => {
    if (item.type === "folder") {
      toggleExpanded(item.path);
    } else if (item.isImage) {
      // Open image in viewer panel - close text editor first
      setEditingTextFile(null);
      setViewingImagePath(item.path);
    } else {
      // Text file - open in editor, close image viewer first
      setViewingImagePath(null);
      setEditingTextFile(item.path);
    }
  };

  const handleDrop = (draggedPath: string, targetFolderPath: string) => {
    // Extract filename from dragged path
    const fileName = draggedPath.split("/").pop() || draggedPath;
    const newPath = targetFolderPath
      ? `${targetFolderPath}/${fileName}`
      : fileName;

    if (draggedPath === newPath) return;

    moveMutation.mutate({
      slug: projectSlug,
      version,
      sourcePath: draggedPath,
      destinationPath: newPath,
    });
  };

  const handleRename = async (item: FileTreeNode, newName: string) => {
    // Compute new path by replacing the filename
    const pathParts = item.path.split("/");
    const oldName = pathParts[pathParts.length - 1];
    pathParts[pathParts.length - 1] = newName;
    const newPath = pathParts.join("/");

    if (item.path === newPath) {
      setRenamingPath(null);
      return;
    }

    // Check if this is a case-only rename (e.g., "Files" -> "files")
    // macOS filesystem is case-insensitive, so we need a two-step rename
    const isCaseOnlyRename =
      oldName.toLowerCase() === newName.toLowerCase() && oldName !== newName;

    if (isCaseOnlyRename) {
      // Two-step rename: first to temp name, then to final name
      const tempName = `${newName}_temp_${Date.now()}`;
      const tempPathParts = [...item.path.split("/")];
      tempPathParts[tempPathParts.length - 1] = tempName;
      const tempPath = tempPathParts.join("/");

      try {
        // Step 1: Rename to temp
        await renameMutation.mutateAsync({
          slug: projectSlug,
          version,
          sourcePath: item.path,
          destinationPath: tempPath,
        });
        // Step 2: Rename to final (handled by onSuccess refetch)
        await renameMutation.mutateAsync({
          slug: projectSlug,
          version,
          sourcePath: tempPath,
          destinationPath: newPath,
        });
      } catch {
        // Error already handled by mutation's onError
      }
    } else {
      renameMutation.mutate({
        slug: projectSlug,
        version,
        sourcePath: item.path,
        destinationPath: newPath,
      });
    }
  };

  // Wrapper for file upload that refetches after upload
  const handleFilesUpload = async (files: FileList, targetPath: string) => {
    if (!onFilesUpload) return;
    try {
      await onFilesUpload(files, targetPath);
      await refetch();
      toast.success(`Uploaded ${files.length} file(s)`);
    } catch (error) {
      // Error handling is done in the parent uploadFiles function
      console.error("Upload error in FileTreeView:", error);
    }
  };

  // Root level drop handlers
  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // Check if this is an external file drop
    const hasFiles = e.dataTransfer.types.includes("Files");
    const hasInternalPath = e.dataTransfer.types.includes(
      "application/x-file-path",
    );

    if (hasFiles && !hasInternalPath) {
      setIsExternalDrag(true);
      e.dataTransfer.dropEffect = "copy";
    } else {
      setIsExternalDrag(false);
      e.dataTransfer.dropEffect = "move";
    }
    setRootDragOver(true);
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    // Only set false if we're leaving the root container, not entering a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setRootDragOver(false);
      setIsExternalDrag(false);
    }
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    setIsExternalDrag(false);

    // Check for internal file move first (takes precedence)
    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (draggedPath) {
      // Move to root (empty target path)
      handleDrop(draggedPath, "");
      return;
    }

    // Check for external file drop
    if (
      e.dataTransfer.files &&
      e.dataTransfer.files.length > 0 &&
      onFilesUpload
    ) {
      // External files - upload to root
      handleFilesUpload(e.dataTransfer.files, "");
      return;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.tree?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
        <p>No files found</p>
      </div>
    );
  }

  const renderTree = (nodes: FileTreeNode[], depth: number = 0) => {
    return nodes.map((node) => (
      <div key={node.path} className="overflow-hidden min-w-0">
        <FileTreeItem
          item={node}
          depth={depth}
          isExpanded={expandedPaths.has(node.path)}
          isViewing={node.isImage && viewingImagePath === node.path}
          onClick={() => handleItemClick(node)}
          onDrop={handleDrop}
          projectSlug={projectSlug}
          version={version}
          onDelete={onDelete}
          onDownload={onDownload}
          onAiEdit={onAiEdit}
          onCreateFolder={onCreateFolder}
          onAddToChat={onAddToChat}
          onRename={handleRename}
          isRenaming={renamingPath === node.path}
          onStartRename={(item) => setRenamingPath(item.path)}
          onCancelRename={() => setRenamingPath(null)}
        />
        {node.type === "folder" &&
          node.children &&
          expandedPaths.has(node.path) && (
            <FolderDropZone
              folderPath={node.path}
              depth={depth + 1}
              onDrop={handleDrop}
              onFilesUpload={onFilesUpload ? handleFilesUpload : undefined}
            >
              {renderTree(node.children, depth + 1)}
            </FolderDropZone>
          )}
      </div>
    ));
  };

  return (
    <div
      className={`py-1 min-h-[200px] w-full min-w-0 overflow-hidden ${rootDragOver ? "bg-primary/5" : ""}`}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      {renderTree(data.tree)}
      {/* Root drop indicator */}
      {rootDragOver && (
        <div className="mx-2 my-1 px-2 py-1 text-xs text-muted-foreground border border-dashed border-primary rounded bg-primary/10">
          {isExternalDrag
            ? "Drop files here to upload"
            : "Drop here to move to root"}
        </div>
      )}
    </div>
  );
}

// Component for folder content area that accepts drops
function FolderDropZone({
  folderPath,
  depth,
  onDrop,
  onFilesUpload,
  children,
}: {
  folderPath: string;
  depth: number;
  onDrop: (draggedPath: string, targetPath: string) => void;
  onFilesUpload?: (files: FileList, targetPath: string) => Promise<void>;
  children: React.ReactNode;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExternalDrag, setIsExternalDrag] = useState(false);

  // Global dragend listener to clean up state
  useEffect(() => {
    const handleDragEnd = () => {
      setIsDragOver(false);
      setIsExternalDrag(false);
    };
    document.addEventListener("dragend", handleDragEnd);
    return () => document.removeEventListener("dragend", handleDragEnd);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if this is an external file drop
    const hasFiles = e.dataTransfer.types.includes("Files");
    const hasInternalPath = e.dataTransfer.types.includes(
      "application/x-file-path",
    );

    if (hasFiles && !hasInternalPath) {
      setIsExternalDrag(true);
      e.dataTransfer.dropEffect = "copy";
    } else {
      setIsExternalDrag(false);
      e.dataTransfer.dropEffect = "move";
    }
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      setIsExternalDrag(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setIsExternalDrag(false);

    // Check for internal file move first (takes precedence)
    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (draggedPath) {
      // Don't drop into itself or its children
      if (
        draggedPath === folderPath ||
        draggedPath.startsWith(folderPath + "/")
      ) {
        return;
      }
      onDrop(draggedPath, folderPath);
      return;
    }

    // Check for external file drop
    if (
      e.dataTransfer.files &&
      e.dataTransfer.files.length > 0 &&
      onFilesUpload
    ) {
      onFilesUpload(e.dataTransfer.files, folderPath);
      return;
    }
  };

  return (
    <div
      className={`overflow-hidden min-w-0 ${isDragOver ? "bg-primary/10" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {/* Show drop indicator when folder is empty or dragging over */}
      {isDragOver && (
        <div
          className="text-xs text-muted-foreground border border-dashed border-primary rounded bg-primary/10 mx-1 my-0.5 py-0.5 px-2"
          style={{ marginLeft: `${depth * 12 + 8}px` }}
        >
          {isExternalDrag
            ? `Upload to ${folderPath.split("/").pop()}`
            : `Drop into ${folderPath.split("/").pop()}`}
        </div>
      )}
    </div>
  );
}
