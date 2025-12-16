import { Folder, File, FileText, Image as ImageIcon } from "lucide-react";
import type { AssetItem } from "./types";

export function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIconComponent(item: AssetItem) {
  if (item.type === "folder") {
    return { icon: Folder, className: "w-8 h-8 text-amber-500" };
  }
  if (item.isImage) {
    return { icon: ImageIcon, className: "w-8 h-8 text-blue-500" };
  }
  if (item.mimeType?.includes("pdf")) {
    return { icon: FileText, className: "w-8 h-8 text-red-500" };
  }
  return { icon: File, className: "w-8 h-8 text-gray-500" };
}

export function buildImageUrl(
  projectSlug: string,
  version: number,
  path: string
): string {
  return `/api/generated/${projectSlug}/v${version}/${path}`;
}
