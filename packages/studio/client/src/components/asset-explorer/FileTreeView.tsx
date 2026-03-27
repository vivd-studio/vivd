import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";

import type { FileTreeNode } from "./types";
import { FileTreeItem } from "./FileTreeItem";
import {
  buildImageUrl,
  getFileTreeIndentPx,
  isTextFile,
  shouldIgnoreFileTreeMoveTarget,
  STUDIO_UPLOADS_PATH,
} from "./utils";
import { usePreview } from "@/components/preview/PreviewContext";

export interface FileTreeMoveTarget {
  path: string;
  label: string;
}

interface FileTreeViewProps {
  projectSlug: string;
  version: number;
  revealPath?: string | null;
  highlightedPath?: string | null;
  onRevealHandled?: () => void;
  onRefetch?: () => void;
  onFilesUpload?: (files: FileList, targetPath: string) => Promise<void>;
  onDelete?: (item: FileTreeNode) => void;
  onDownload?: (item: FileTreeNode) => void;
  onAiEdit?: (item: FileTreeNode) => void;
  onCreateFolder?: (parentPath: string) => void;
  onAddToChat?: (item: FileTreeNode) => void;
}

function getParentPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  return lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex) : "";
}

export function getFileTreeMoveTargets(
  tree: FileTreeNode[],
  item: FileTreeNode,
): FileTreeMoveTarget[] {
  const targets: FileTreeMoveTarget[] = [{ path: "", label: "Project Root" }];
  const currentParentPath = getParentPath(item.path);

  const visit = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "folder") {
        if (shouldIgnoreFileTreeMoveTarget(node.path)) {
          continue;
        }
        targets.push({
          path: node.path,
          label: node.path,
        });
        if (node.children?.length) {
          visit(node.children);
        }
      }
    }
  };

  visit(tree);

  return targets.filter((target) => {
    if (target.path === currentParentPath) {
      return false;
    }

    if (
      item.type === "folder" &&
      (target.path === item.path || target.path.startsWith(`${item.path}/`))
    ) {
      return false;
    }

    return true;
  });
}

export function FileTreeView({
  projectSlug,
  version,
  revealPath,
  highlightedPath,
  onRevealHandled,
  onRefetch,
  onFilesUpload,
  onDelete,
  onDownload,
  onAiEdit,
  onCreateFolder,
  onAddToChat,
}: FileTreeViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [externalRootDragOver, setExternalRootDragOver] = useState(false);
  const [activeExternalDropTarget, setActiveExternalDropTarget] = useState<
    string | null
  >(null);
  const [activeInternalDropTarget, setActiveInternalDropTarget] = useState<
    string | "" | null
  >(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const {
    editingTextFile,
    setEditingTextFile,
    viewingImagePath,
    setViewingImagePath,
    viewingPdfPath,
    setViewingPdfPath,
  } = usePreview();

  const isPdfFile = (item: FileTreeNode) =>
    item.mimeType?.includes("pdf") || item.name.toLowerCase().endsWith(".pdf");

  // Global dragend listener to clean up state when drag is cancelled
  useEffect(() => {
    const handleDragEnd = () => {
      setExternalRootDragOver(false);
      setActiveExternalDropTarget(null);
      setActiveInternalDropTarget(null);
    };
    document.addEventListener("dragend", handleDragEnd);
    return () => document.removeEventListener("dragend", handleDragEnd);
  }, []);

  useEffect(() => {
    const normalizedPath = revealPath
      ?.replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    if (!normalizedPath) {
      return;
    }

    const pathSegments = normalizedPath.split("/").filter(Boolean);
    if (pathSegments.length === 0) {
      return;
    }

    setExpandedPaths((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (let index = 0; index < pathSegments.length; index += 1) {
        const path = pathSegments.slice(0, index + 1).join("/");
        if (!next.has(path)) {
          next.add(path);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    onRevealHandled?.();
  }, [onRevealHandled, revealPath]);

  useEffect(() => {
    if (!highlightedPath) {
      return;
    }

    setSelectedPath(highlightedPath);
  }, [highlightedPath]);

  useEffect(() => {
    if (!highlightedPath) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      const treeRoot = rootRef.current;
      if (!treeRoot) {
        return;
      }

      const treeItem = Array.from(
        treeRoot.querySelectorAll<HTMLElement>("[data-file-tree-path]"),
      ).find(
        (element) =>
          element.getAttribute("data-file-tree-path") === highlightedPath,
      );

      treeItem?.scrollIntoView({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frameId);
  }, [expandedPaths, highlightedPath]);

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
    setSelectedPath(item.path);

    if (item.type === "folder") {
      toggleExpanded(item.path);
    } else if (item.isImage) {
      // Open image in viewer panel - close text editor first
      setEditingTextFile(null);
      setViewingPdfPath(null);
      setViewingImagePath(item.path);
    } else if (isPdfFile(item)) {
      // Open PDF in viewer panel - close other overlays first
      setEditingTextFile(null);
      setViewingImagePath(null);
      setViewingPdfPath(item.path);
    } else if (isTextFile(item.name)) {
      // Text file - open in editor, close other overlays first
      setViewingImagePath(null);
      setViewingPdfPath(null);
      setEditingTextFile(item.path);
    } else {
      // Binary/unknown file - open in a new tab (download fallback)
      const url = buildImageUrl(projectSlug, version, item.path);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = url;
        link.download = item.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      toast.info("Opened file in a new tab", { description: item.name });
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
    } catch (error) {
      // Error handling is done in the parent uploadFiles function
      console.error("Upload error in FileTreeView:", error);
    }
  };

  // Root level drop handlers
  const handleRootDragOver = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes("Files");
    const hasInternalPath = e.dataTransfer.types.includes(
      "application/x-file-path",
    );

    if (hasFiles && !hasInternalPath) {
      if (e.target !== e.currentTarget) {
        return;
      }
      e.preventDefault();
      setExternalRootDragOver(true);
      setActiveExternalDropTarget(null);
      setActiveInternalDropTarget(null);
      e.dataTransfer.dropEffect = "copy";
      return;
    }

    if (!hasInternalPath || e.target !== e.currentTarget) {
      return;
    }

    e.preventDefault();
    setExternalRootDragOver(false);
    setActiveInternalDropTarget("");
    e.dataTransfer.dropEffect = "move";
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    // Only set false if we're leaving the root container, not entering a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setExternalRootDragOver(false);
      setActiveExternalDropTarget(null);
      if (activeInternalDropTarget === "") {
        setActiveInternalDropTarget(null);
      }
    }
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setExternalRootDragOver(false);
    setActiveExternalDropTarget(null);
    setActiveInternalDropTarget(null);

    // Check for internal file move first (takes precedence)
    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (draggedPath) {
      if (e.target !== e.currentTarget) {
        return;
      }
      // Move to root (empty target path)
      handleDrop(draggedPath, "");
      return;
    }

    // Check for external file drop
    if (
      e.target === e.currentTarget &&
      e.dataTransfer.files &&
      e.dataTransfer.files.length > 0 &&
      onFilesUpload
    ) {
      handleFilesUpload(e.dataTransfer.files, STUDIO_UPLOADS_PATH);
      return;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <LoadingSpinner message="Loading files..." />
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
          isViewing={
            selectedPath === node.path ||
            (node.type === "file" &&
              ((node.isImage && viewingImagePath === node.path) ||
                (isPdfFile(node) && viewingPdfPath === node.path) ||
                (isTextFile(node.name) && editingTextFile === node.path)))
          }
          onClick={() => handleItemClick(node)}
          onDrop={handleDrop}
          projectSlug={projectSlug}
          version={version}
          onDelete={onDelete}
          onDownload={onDownload}
          onAiEdit={onAiEdit}
          onCreateFolder={onCreateFolder}
          onAddToChat={onAddToChat}
          onFilesUpload={onFilesUpload ? handleFilesUpload : undefined}
          moveTargets={getFileTreeMoveTargets(data.tree, node)}
          onMoveToFolder={(targetFolderPath) =>
            handleDrop(node.path, targetFolderPath)
          }
          onRename={handleRename}
          isRenaming={renamingPath === node.path}
          onStartRename={(item) => setRenamingPath(item.path)}
          onCancelRename={() => setRenamingPath(null)}
          activeInternalDropTargetPath={activeInternalDropTarget}
          onInternalDropTargetChange={setActiveInternalDropTarget}
          activeExternalDropTargetPath={activeExternalDropTarget}
          onExternalDropTargetChange={(targetPath) => {
            setExternalRootDragOver(false);
            setActiveExternalDropTarget(targetPath);
          }}
        />
        {node.type === "folder" &&
          node.children &&
          expandedPaths.has(node.path) && (
            <FolderDropZone
              folderPath={node.path}
              depth={depth + 1}
              onDrop={handleDrop}
              onFilesUpload={onFilesUpload ? handleFilesUpload : undefined}
              activeInternalDropTargetPath={activeInternalDropTarget}
              onInternalDropTargetChange={setActiveInternalDropTarget}
              activeExternalDropTargetPath={activeExternalDropTarget}
              onExternalDropTargetChange={(targetPath) => {
                setExternalRootDragOver(false);
                setActiveExternalDropTarget(targetPath);
              }}
            >
              {renderTree(node.children, depth + 1)}
            </FolderDropZone>
          )}
      </div>
    ));
  };

  const showRootDropIndicator =
    externalRootDragOver || activeInternalDropTarget === "";

  return (
    <div
      ref={rootRef}
      className={`py-1 min-h-[200px] w-full min-w-0 overflow-hidden ${showRootDropIndicator ? "bg-primary/5" : ""}`}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      data-testid="file-tree-root"
    >
      {renderTree(data.tree)}
      {/* Root drop indicator */}
      {showRootDropIndicator && (
        <div className="pointer-events-none mx-2 my-1 px-2 py-1 text-xs text-muted-foreground border border-dashed border-primary rounded bg-primary/10">
          {externalRootDragOver
            ? `Drop files here to upload to ${STUDIO_UPLOADS_PATH}`
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
  activeInternalDropTargetPath,
  onInternalDropTargetChange,
  activeExternalDropTargetPath,
  onExternalDropTargetChange,
}: {
  folderPath: string;
  depth: number;
  onDrop: (draggedPath: string, targetPath: string) => void;
  onFilesUpload?: (files: FileList, targetPath: string) => Promise<void>;
  children: React.ReactNode;
  activeInternalDropTargetPath: string | "" | null;
  onInternalDropTargetChange: (targetPath: string | "" | null) => void;
  activeExternalDropTargetPath: string | null;
  onExternalDropTargetChange: (targetPath: string | null) => void;
}) {
  const dropKind =
    activeInternalDropTargetPath === folderPath
      ? "internal"
      : activeExternalDropTargetPath === folderPath
        ? "external"
        : null;
  const isDragOver = dropKind !== null;

  const handleDragOver = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types.includes("Files");
    const hasInternalPath = e.dataTransfer.types.includes(
      "application/x-file-path",
    );
    if (hasFiles && !hasInternalPath) {
      e.preventDefault();
      e.stopPropagation();
      onInternalDropTargetChange(null);
      onExternalDropTargetChange(
        shouldIgnoreFileTreeMoveTarget(folderPath) ? null : folderPath,
      );
      e.dataTransfer.dropEffect = shouldIgnoreFileTreeMoveTarget(folderPath)
        ? "none"
        : "copy";
      return;
    }

    if (!hasInternalPath) {
      return;
    }

    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (
      draggedPath === folderPath ||
      folderPath.startsWith(`${draggedPath}/`)
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    onExternalDropTargetChange(null);
    onInternalDropTargetChange(folderPath);
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (activeInternalDropTargetPath === folderPath) {
        onInternalDropTargetChange(null);
      }
      if (activeExternalDropTargetPath === folderPath) {
        onExternalDropTargetChange(null);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (draggedPath) {
      e.preventDefault();
      e.stopPropagation();
      if (activeInternalDropTargetPath === folderPath) {
        onInternalDropTargetChange(null);
      }
      if (activeExternalDropTargetPath === folderPath) {
        onExternalDropTargetChange(null);
      }

      // Don't drop into itself or its children
      if (
        draggedPath === folderPath ||
        folderPath.startsWith(`${draggedPath}/`)
      ) {
        return;
      }

      onDrop(draggedPath, folderPath);
      return;
    }

    if (
      e.dataTransfer.files &&
      e.dataTransfer.files.length > 0 &&
      onFilesUpload
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (activeInternalDropTargetPath === folderPath) {
        onInternalDropTargetChange(null);
      }
      if (activeExternalDropTargetPath === folderPath) {
        onExternalDropTargetChange(null);
      }
      if (shouldIgnoreFileTreeMoveTarget(folderPath)) {
        return;
      }
      void onFilesUpload(e.dataTransfer.files, folderPath);
    }
  };

  return (
    <div
      className={`overflow-hidden min-w-0 ${isDragOver ? "bg-primary/10" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-folder-drop-zone={folderPath}
    >
      {children}
      {/* Show drop indicator when folder is empty or dragging over */}
      {isDragOver && (
        <div
          className="pointer-events-none text-xs text-muted-foreground border border-dashed border-primary rounded bg-primary/10 mx-1 my-0.5 py-0.5 px-2"
          style={{ marginLeft: `${getFileTreeIndentPx(depth)}px` }}
        >
          {dropKind === "external"
            ? `Upload to ${folderPath.split("/").pop()}`
            : `Drop into ${folderPath.split("/").pop()}`}
        </div>
      )}
    </div>
  );
}
