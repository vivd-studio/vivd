import { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Download,
  FolderPlus,
  Pencil,
  Trash2,
  Wand2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { FileTreeNode } from "./types";
import { getFileIconComponent } from "./utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// Folders to gray out (build outputs, dependencies, internal)
const GRAYED_FOLDERS = [
  "dist",
  "build",
  "node_modules",
  ".next",
  ".nuxt",
  ".output",
  ".vivd",
];

interface FileTreeItemProps {
  item: FileTreeNode;
  depth: number;
  isExpanded: boolean;
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
}

export function FileTreeItem({
  item,
  depth,
  isExpanded,
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
}: FileTreeItemProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [renameValue, setRenameValue] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const { icon: Icon, className: iconClassName } = getFileIconComponent(item);

  const isGrayed = item.type === "folder" && GRAYED_FOLDERS.includes(item.name);

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
    if (item.isImage) {
      const imageUrl = `/vivd-studio/api/assets/${projectSlug}/${version}/${item.path}`;
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
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (item.type !== "folder") return;

    const draggedPath = e.dataTransfer.getData("application/x-file-path");
    if (!draggedPath) return;

    // Don't drop on itself or its parent
    if (draggedPath === item.path || item.path.startsWith(draggedPath + "/")) {
      return;
    }

    onDrop(draggedPath, item.path);
  };

  const itemContent = (
    <div
      className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-muted/50 transition-colors ${
        isDragOver ? "bg-primary/10 ring-1 ring-primary" : ""
      } ${isGrayed ? "opacity-50" : ""}`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={isRenaming ? undefined : onClick}
      draggable={item.type === "file" && !isRenaming}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Expand/collapse chevron for folders */}
      {item.type === "folder" ? (
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      {/* File/folder icon */}
      <Icon className={`${iconClassName} w-4! h-4! shrink-0`} />

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
        <span className="text-sm truncate">{item.name}</span>
      )}
    </div>
  );

  // Only show context menu if we have any handlers
  if (!onDelete && !onDownload && !onAiEdit && !onCreateFolder && !onStartRename) {
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

        {/* AI Edit - only for images */}
        {item.type === "file" && item.isImage && onAiEdit && (
          <ContextMenuItem onClick={() => onAiEdit(item)}>
            <Wand2 className="mr-2 h-4 w-4" />
            AI Edit
          </ContextMenuItem>
        )}

        {/* Separator before delete if there are other items */}
        {onDelete &&
          (onStartRename ||
            (item.type === "file" && (onDownload || (item.isImage && onAiEdit))) ||
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
