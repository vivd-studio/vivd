import { useCallback } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

import type { AssetItem } from "./types";
import { AssetItemCard } from "./AssetItemCard";
import { buildImageUrl } from "./utils";
import { usePermissions } from "@/hooks/usePermissions";

interface ImageGalleryViewProps {
  projectSlug: string;
  version: number;
  currentPath: string;
  onNavigate: (path: string) => void;
  onImagePreview: (url: string, item: AssetItem) => void;
  onAiEdit?: (item: AssetItem) => void;
  onDelete: (item: AssetItem) => void;
  onTextEdit: (path: string) => void;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function ImageGalleryView({
  projectSlug,
  version,
  currentPath,
  onNavigate,
  onImagePreview,
  onAiEdit,
  onDelete,
  onTextEdit,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
}: ImageGalleryViewProps) {
  const { canUseAiImages } = usePermissions();

  const { data, isLoading } = trpc.assets.listAssets.useQuery({
    slug: projectSlug,
    version,
    relativePath: currentPath,
  });

  const handleItemClick = useCallback(
    (item: AssetItem) => {
      if (item.type === "folder") {
        onNavigate(item.path);
      } else if (item.isImage) {
        onImagePreview(buildImageUrl(projectSlug, version, item.path), item);
      } else if (item.type === "file") {
        onTextEdit(item.path);
      }
    },
    [projectSlug, version, onNavigate, onImagePreview, onTextEdit]
  );

  const handleDownload = useCallback(
    (item: AssetItem, e: React.MouseEvent) => {
      e.stopPropagation();
      const url = buildImageUrl(projectSlug, version, item.path);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    [projectSlug, version]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <div
        className={`min-h-[200px] flex flex-col items-center justify-center text-muted-foreground ${
          isDragging ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <p>No files yet</p>
        <p className="text-sm">Drop files here or click Upload</p>
      </div>
    );
  }

  return (
    <div
      className={`p-4 min-h-full ${
        isDragging ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="grid grid-cols-2 gap-2">
        {data.items.map((item) => (
          <AssetItemCard
            key={item.path}
            item={item}
            projectSlug={projectSlug}
            version={version}
            onClick={() => handleItemClick(item)}
            onDelete={(e) => {
              e.stopPropagation();
              onDelete(item);
            }}
            onAiEdit={
              canUseAiImages && item.type === "file" && item.isImage && onAiEdit
                ? (e) => {
                    e.stopPropagation();
                    onAiEdit(item);
                  }
                : undefined
            }
            onDownload={
              item.type === "file" ? (e) => handleDownload(item, e) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
