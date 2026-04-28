import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { LoadingSpinner } from "@/components/common";

import type { AssetItem } from "./types";
import { AssetItemCard } from "./AssetItemCard";
import { buildImageUrl } from "./utils";
import { usePermissions } from "@/hooks/usePermissions";
import { usePreview } from "@/components/preview/PreviewContext";

interface ImageGalleryViewProps {
  projectSlug: string;
  version: number;
  currentPath: string;
  itemsOverride?: AssetItem[];
  isLoadingOverride?: boolean;
  emptyLabel?: string;
  onAiEdit?: (item: AssetItem) => void;
  onDelete: (item: AssetItem) => void;
  onAddToChat?: (item: AssetItem) => void;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function ImageGalleryView({
  projectSlug,
  version,
  currentPath,
  itemsOverride,
  isLoadingOverride,
  emptyLabel = "No images yet",
  onAiEdit,
  onDelete,
  onAddToChat,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
}: ImageGalleryViewProps) {
  const { canUseAiImages } = usePermissions();
  const { setViewingImagePath, viewingImagePath } = usePreview();

  const { data, isLoading } = trpc.assets.listAssets.useQuery(
    {
      slug: projectSlug,
      version,
      relativePath: currentPath,
    },
    {
      staleTime: 0,
      enabled: !itemsOverride,
    },
  );
  const items = (itemsOverride ?? data?.items ?? []).filter(
    (item) => item.type === "file" && item.isImage,
  );
  const loading = isLoadingOverride ?? isLoading;

  const handleItemClick = useCallback(
    (item: AssetItem) => {
      if (item.isImage) {
        setViewingImagePath(item.path);
      }
    },
    [setViewingImagePath],
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <LoadingSpinner message="Loading images..." />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div
        className={`min-h-[200px] flex flex-col items-center justify-center text-muted-foreground ${
          isDragging ? "bg-primary/10 ring-2 ring-primary ring-inset" : ""
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <p>{emptyLabel}</p>
        <p className="text-sm">Drop images here to add them to the library.</p>
        <p className="text-xs">Other file types are available in Files.</p>
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
      {/* Masonry layout with 2 columns */}
      <div className="columns-2 gap-2">
        {items.map((item) => (
          <div key={item.path} className="break-inside-avoid mb-2">
            <AssetItemCard
              item={item}
              projectSlug={projectSlug}
              version={version}
              isViewing={item.type === "file" && item.isImage && viewingImagePath === item.path}
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
              onAddToChat={
                item.type === "file" && onAddToChat
                  ? () => onAddToChat(item)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
