import { Button } from "@/components/ui/button";
import { Trash2, Wand2 } from "lucide-react";
import type { AssetItem } from "./types";
import { formatSize, getFileIconComponent, buildImageUrl } from "./utils";
import { ImageThumbnail } from "./ImageThumbnail";

interface AssetItemCardProps {
  item: AssetItem;
  projectSlug: string;
  version: number;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onAiEdit?: (e: React.MouseEvent) => void;
}

export function AssetItemCard({
  item,
  projectSlug,
  version,
  onClick,
  onDelete,
  onAiEdit,
}: AssetItemCardProps) {
  const { icon: Icon, className: iconClassName } = getFileIconComponent(item);

  // Action buttons for images
  const imageActions = (
    <>
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

  // Use ImageThumbnail for images
  if (item.type === "file" && item.isImage) {
    return (
      <ImageThumbnail
        item={item}
        imageUrl={buildImageUrl(projectSlug, version, item.path)}
        onClick={onClick}
        actions={imageActions}
      />
    );
  }

  // Folder or non-image file
  return (
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
}
