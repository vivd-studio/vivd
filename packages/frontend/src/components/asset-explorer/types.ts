export interface AssetItem {
  name: string;
  type: "file" | "folder";
  path: string;
  size?: number;
  mimeType?: string;
  isImage?: boolean;
  width?: number;
  height?: number;
}

export type ViewMode = "gallery" | "files";

export interface FileTreeNode {
  name: string;
  type: "file" | "folder";
  path: string;
  children?: FileTreeNode[];
  size?: number;
  mimeType?: string;
  isImage?: boolean;
}

export interface AssetExplorerContextProps {
  projectSlug: string;
  version: number;
  currentPath: string;
  setCurrentPath: (path: string) => void;
  refetch: () => void;
}
