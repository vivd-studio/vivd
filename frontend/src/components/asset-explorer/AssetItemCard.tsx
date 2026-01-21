import { Button } from "@/components/ui/button";
import { Download, MessageSquarePlus, Trash2, Wand2 } from "lucide-react";
import type { AssetItem } from "./types";
import { formatSize, getFileIconComponent, buildImageUrl } from "./utils";
import { ImageThumbnail } from "./ImageThumbnail";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface AssetItemCardProps {
  item: AssetItem;
  projectSlug: string;
  version: number;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onAiEdit?: (e: React.MouseEvent) => void;
  onDownload?: (e: React.MouseEvent) => void;
  onAddToChat?: () => void;
}

export function AssetItemCard({
  item,
  projectSlug,
  version,
  onClick,
  onDelete,
  onAiEdit,
  onDownload,
  onAddToChat,
}: AssetItemCardProps) {
  const { icon: Icon, className: iconClassName } = getFileIconComponent(item);

  // Action buttons for images
  const imageActions = (
    <>
      {onDownload && (
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6"
          onClick={onDownload}
          title="Download"
        >
          <Download className="h-3 w-3" />
        </Button>
      )}
      {onAddToChat && (
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onAddToChat();
          }}
          title="Add to Chat"
        >
          <MessageSquarePlus className="h-3 w-3" />
        </Button>
      )}
      {onAiEdit && (
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6"
          onClick={onAiEdit}
          title="Edit with AI"
        >
          <Wand2 className="h-3 w-3" />
        </Button>
      )}
      <Button
        variant="destructive"
        size="icon"
        className="h-6 w-6"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </>
  );

  // Context menu content for files
  const contextMenuContent = item.type === "file" && (
    <ContextMenuContent className="w-48">
      {onDownload && (
        <ContextMenuItem onClick={(e) => onDownload(e as any)}>
          <Download className="mr-2 h-4 w-4" />
          Download
        </ContextMenuItem>
      )}
      {onAddToChat && (
        <ContextMenuItem onClick={onAddToChat}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          Add to Chat
        </ContextMenuItem>
      )}
      {onAiEdit && item.isImage && (
        <ContextMenuItem onClick={(e) => onAiEdit(e as any)}>
          <Wand2 className="mr-2 h-4 w-4" />
          AI Edit
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={(e) => onDelete(e as any)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );

  // Use ImageThumbnail for images
  if (item.type === "file" && item.isImage) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <ImageThumbnail
              item={item}
              imageUrl={buildImageUrl(projectSlug, version, item.path)}
              onClick={onClick}
              actions={imageActions}
            />
          </div>
        </ContextMenuTrigger>
        {contextMenuContent}
      </ContextMenu>
    );
  }

  // Folder or non-image file
  const cardContent = (
    <div
      onClick={onClick}
      className="relative group p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
    >
      <div className="flex flex-col items-center gap-2">
        <div className="w-16 h-16 flex items-center justify-center">
          <Icon className={iconClassName} />
        </div>
        <div className="text-center w-full">
          <p className="text-sm font-medium truncate w-full">{item.name}</p>
          {item.type === "file" && item.size !== undefined && (
            <p className="text-xs text-muted-foreground">
              {formatSize(item.size)}
            </p>
          )}
        </div>
      </div>
      {/* Action buttons */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onDownload && item.type === "file" && (
          <Button
            variant="secondary"
            size="icon"
            className="h-6 w-6"
            onClick={onDownload}
            title="Download"
          >
            <Download className="h-3 w-3" />
          </Button>
        )}
        {/* Delete button */}
        <Button
          variant="destructive"
          size="icon"
          className="h-6 w-6"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );

  // Wrap files with context menu, folders don't need it
  if (item.type === "file") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{cardContent}</ContextMenuTrigger>
        {contextMenuContent}
      </ContextMenu>
    );
  }

  return cardContent;
}
