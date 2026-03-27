import { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Download,
  FolderPlus,
  MessageSquarePlus,
  Pencil,
  Trash2,
  Wand2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FileTreeNode } from "./types";
import {
  buildAssetFileUrl,
  canDragAssetToPreview,
  getFileTreeIconComponent,
  getFileTreeIndentPx,
  isFileTreeGrayedFolder,
  shouldIgnoreFileTreeMoveTarget,
} from "./utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FileTreeMoveTarget } from "./FileTreeView";

interface FileTreeItemProps {
  item: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  isViewing?: boolean;
  onClick: () => void;
  onDrop: (draggedPath: string, targetFolderPath: string) => void;
  projectSlug: string;
  version: number;
  onDelete?: (item: FileTreeNode) => void;
  onDownload?: (item: FileTreeNode) => void;
  onAiEdit?: (item: FileTreeNode) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRename?: (item: FileTreeNode, newName: string) => void;
  isRenaming?: boolean;
  onStartRename?: (item: FileTreeNode) => void;
  onCancelRename?: () => void;
  onAddToChat?: (item: FileTreeNode) => void;
  onFilesUpload?: (files: FileList, targetFolderPath: string) => Promise<void>;
  moveTargets?: FileTreeMoveTarget[];
  onMoveToFolder?: (targetFolderPath: string) => void;
  activeInternalDropTargetPath?: string | null;
  onInternalDropTargetChange?: (targetPath: string | null) => void;
  activeExternalDropTargetPath?: string | null;
  onExternalDropTargetChange?: (targetPath: string | null) => void;
}

export function FileTreeItem({
  item,
  depth,
  isExpanded,
  isViewing,
  onClick,
  onDrop,
  projectSlug,
  version,
  onDelete,
  onDownload,
  onAiEdit,
  onCreateFolder,
  onRename,
  isRenaming,
  onStartRename,
  onCancelRename,
  onAddToChat,
  onFilesUpload,
  moveTargets,
  onMoveToFolder,
  activeInternalDropTargetPath,
  onInternalDropTargetChange,
  activeExternalDropTargetPath,
  onExternalDropTargetChange,
}: FileTreeItemProps) {
  const [renameValue, setRenameValue] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileIcon = getFileTreeIconComponent(item);

  const isGrayed = item.type === "folder" && isFileTreeGrayedFolder(item.name);
  const isDropTarget =
    item.type === "folder" &&
    (activeInternalDropTargetPath === item.path ||
      activeExternalDropTargetPath === item.path);

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      setRenameValue(item.name);
      const input = inputRef.current;
      // Use requestAnimationFrame to ensure selection happens after React updates the value
      requestAnimationFrame(() => {
        input.focus();
        // Select the name without extension for files
        const dotIndex = item.name.lastIndexOf(".");
        if (item.type === "file" && dotIndex > 0) {
          input.setSelectionRange(0, dotIndex);
        } else {
          input.select();
        }
      });
    }
  }, [isRenaming, item.name, item.type]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== item.name && onRename) {
      onRename(item, trimmed);
    } else {
      onCancelRename?.();
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancelRename?.();
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Set path for internal file moving
    e.dataTransfer.setData("application/x-file-path", item.path);

    // For images, also set the asset data types so they can be dropped onto the website preview
    if (item.isImage && canDragAssetToPreview(item.path)) {
      const imageUrl = buildAssetFileUrl(projectSlug, version, item.path);
      e.dataTransfer.setData("text/plain", item.path);
      e.dataTransfer.setData("application/x-asset-path", item.path);
      e.dataTransfer.setData("application/x-asset-url", imageUrl);
      e.dataTransfer.effectAllowed = "copyMove";

      // Create a custom drag image for images
      const dragPreview = document.createElement("div");
      dragPreview.style.cssText = `
        width: 60px;
        height: 60px;
        border: 2px solid #22c55e;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
        overflow: hidden;
        background: white;
        position: absolute;
        top: -9999px;
        left: -9999px;
      `;

      const img = document.createElement("img");
      img.src = imageUrl;
      img.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
      `;
      dragPreview.appendChild(img);
      document.body.appendChild(dragPreview);

      e.dataTransfer.setDragImage(dragPreview, 30, 30);

      // Clean up the element after drag starts
      requestAnimationFrame(() => {
        document.body.removeChild(dragPreview);
      });
    } else {
      e.dataTransfer.effectAllowed = "move";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (item.type !== "folder") return;
    const hasFiles = e.dataTransfer.types.includes("Files");
    const hasInternalPath = e.dataTransfer.types.includes(
      "application/x-file-path",
    );

    if (hasFiles && !hasInternalPath) {
      e.preventDefault();
      e.stopPropagation();
      onInternalDropTargetChange?.(null);
      onExternalDropTargetChange?.(
        shouldIgnoreFileTreeMoveTarget(item.path) ? null : item.path,
      );
      e.dataTransfer.dropEffect = shouldIgnoreFileTreeMoveTarget(item.path)
        ? "none"
        : "copy";
      return;
    }

    if (!hasInternalPath) return;

    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (draggedPath === item.path || item.path.startsWith(draggedPath + "/")) {
      onInternalDropTargetChange?.(null);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    onExternalDropTargetChange?.(null);
    onInternalDropTargetChange?.(item.path);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    if (activeInternalDropTargetPath === item.path) {
      onInternalDropTargetChange?.(null);
    }
    if (activeExternalDropTargetPath === item.path) {
      onExternalDropTargetChange?.(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (activeInternalDropTargetPath === item.path) {
      onInternalDropTargetChange?.(null);
    }
    if (activeExternalDropTargetPath === item.path) {
      onExternalDropTargetChange?.(null);
    }

    if (item.type !== "folder") return;

    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (draggedPath) {
      e.preventDefault();
      e.stopPropagation();

      // Don't drop on itself or its parent
      if (draggedPath === item.path || item.path.startsWith(draggedPath + "/")) {
        return;
      }

      onDrop(draggedPath, item.path);
      return;
    }

    if (
      e.dataTransfer.files &&
      e.dataTransfer.files.length > 0 &&
      onFilesUpload
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (shouldIgnoreFileTreeMoveTarget(item.path)) {
        return;
      }
      void onFilesUpload(e.dataTransfer.files, item.path);
    }
  };

  const itemContent = (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 cursor-pointer transition-colors overflow-hidden min-w-0",
        "hover:bg-muted/35",
        isDropTarget && "bg-muted/50 ring-1 ring-border",
        isGrayed && "text-muted-foreground opacity-65",
        isViewing && "bg-muted font-medium",
      )}
      style={{ paddingLeft: `${getFileTreeIndentPx(depth)}px` }}
      onClick={isRenaming ? undefined : onClick}
      draggable={item.type === "file" && !isRenaming}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-file-tree-path={item.path}
    >
      {/* Expand/collapse chevron for folders */}
      {item.type === "folder" ? (
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-foreground/80" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-foreground/80" />
          )}
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      {/* File icon */}
      {fileIcon ? (
        <fileIcon.icon
          className={cn(fileIcon.className, "h-4 w-4 shrink-0")}
        />
      ) : null}

      {/* Name or rename input */}
      {isRenaming ? (
        <Input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={handleRenameSubmit}
          onClick={(e) => e.stopPropagation()}
          className="h-6 py-0 px-1 text-sm"
        />
      ) : (
        <span
          className={cn(
            "text-sm truncate min-w-0",
            item.type === "folder" ? "font-medium" : "font-normal"
          )}
          title={item.name}
        >
          {item.name}
        </span>
      )}
    </div>
  );

  // Only show context menu if we have any handlers
  if (
    !onDelete &&
    !onDownload &&
    !onAiEdit &&
    !onCreateFolder &&
    !onMoveToFolder &&
    !onStartRename &&
    !onAddToChat
  ) {
    return itemContent;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{itemContent}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {/* New Folder - only for folders */}
        {item.type === "folder" && onCreateFolder && (
          <ContextMenuItem onClick={() => onCreateFolder(item.path)}>
            <FolderPlus className="mr-2 h-4 w-4" />
            New Folder
          </ContextMenuItem>
        )}

        {onMoveToFolder && moveTargets && moveTargets.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-80 overflow-y-auto">
              {moveTargets.map((target) => (
                <ContextMenuItem
                  key={target.path || "__root__"}
                  onClick={() => onMoveToFolder(target.path)}
                >
                  {target.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {/* Rename - for all items */}
        {onStartRename && (
          <ContextMenuItem onClick={() => onStartRename(item)}>
            <Pencil className="mr-2 h-4 w-4" />
            Rename
          </ContextMenuItem>
        )}

        {/* Download - only for files */}
        {item.type === "file" && onDownload && (
          <ContextMenuItem onClick={() => onDownload(item)}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </ContextMenuItem>
        )}

        {/* Add to Chat - only for files */}
        {item.type === "file" && onAddToChat && (
          <ContextMenuItem onClick={() => onAddToChat(item)}>
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            Add to Chat
          </ContextMenuItem>
        )}

        {/* AI Edit - only for images */}
        {item.type === "file" && item.isImage && onAiEdit && (
          <ContextMenuItem onClick={() => onAiEdit(item)}>
            <Wand2 className="mr-2 h-4 w-4" />
            AI Edit
          </ContextMenuItem>
        )}

        {/* Separator before delete if there are other items */}
        {onDelete &&
          (onMoveToFolder ||
            onStartRename ||
            (item.type === "file" &&
              (onDownload || onAddToChat || (item.isImage && onAiEdit))) ||
            (item.type === "folder" && onCreateFolder)) && (
            <ContextMenuSeparator />
          )}

        {/* Delete - for all items */}
        {onDelete && (
          <ContextMenuItem
            onClick={() => onDelete(item)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
