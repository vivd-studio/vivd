import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/common";

import type { AssetItem } from "./types";
import { AssetItemCard } from "./AssetItemCard";
import { buildImageUrl, isTextFile, STUDIO_UPLOADS_PATH } from "./utils";
import { usePermissions } from "@/hooks/usePermissions";
import { usePreview } from "@/components/preview/PreviewContext";

interface ImageGalleryViewProps {
  projectSlug: string;
  version: number;
  currentPath: string;
  onNavigate: (path: string) => void;
  onAiEdit?: (item: AssetItem) => void;
  onDelete: (item: AssetItem) => void;
  onTextEdit: (path: string) => void;
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
  onNavigate,
  onAiEdit,
  onDelete,
  onTextEdit,
  onAddToChat,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
}: ImageGalleryViewProps) {
  const { canUseAiImages } = usePermissions();
  const {
    setEditingTextFile,
    setViewingImagePath,
    viewingImagePath,
    setViewingPdfPath,
  } = usePreview();

  const { data, isLoading } = trpc.assets.listAssets.useQuery(
    {
      slug: projectSlug,
      version,
      relativePath: currentPath,
    },
    {
      staleTime: 0,
    },
  );

  const handleItemClick = useCallback(
    (item: AssetItem) => {
      if (item.type === "folder") {
        onNavigate(item.path);
      } else if (item.isImage) {
        // Open image in viewer panel (like code view)
        setEditingTextFile(null);
        setViewingPdfPath(null);
        setViewingImagePath(item.path);
      } else if (item.mimeType?.includes("pdf") || item.name.toLowerCase().endsWith(".pdf")) {
        setEditingTextFile(null);
        setViewingImagePath(null);
        setViewingPdfPath(item.path);
      } else if (item.type === "file" && isTextFile(item.name)) {
        setViewingImagePath(null);
        setViewingPdfPath(null);
        onTextEdit(item.path);
      } else if (item.type === "file") {
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
    },
    [
      onNavigate,
      onTextEdit,
      projectSlug,
      setEditingTextFile,
      setViewingImagePath,
      setViewingPdfPath,
      version,
    ]
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
        <LoadingSpinner message="Loading files..." />
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
        <p className="text-sm">
          Drop files here to upload to {currentPath || STUDIO_UPLOADS_PATH}
        </p>
        <p className="text-xs">
          Use Upload to save working files to {STUDIO_UPLOADS_PATH}
        </p>
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
        {data.items.map((item) => (
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
