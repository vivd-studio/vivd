import {
  Folder,
  File,
  FileText,
  FileCode,
  Image as ImageIcon,
} from "lucide-react";
import type { AssetItem, FileTreeNode } from "./types";
import { getVivdStudioToken, withVivdStudioTokenQuery } from "@/lib/studioAuth";

export const STUDIO_UPLOADS_PATH = ".vivd/uploads";
export const FILE_TREE_INDENT_STEP_PX = 16;
export const FILE_TREE_BASE_PADDING_PX = 12;

function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function hasHiddenPathSegment(assetPath: string): boolean {
  return normalizeAssetPath(assetPath)
    .split("/")
    .some((segment) => segment.startsWith("."));
}

function encodeAssetPathForUrl(assetPath: string): string {
  return normalizeAssetPath(assetPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildStudioFileRequestUrl(basePath: string, assetPath: string): string {
  const normalized = normalizeAssetPath(assetPath);

  if (hasHiddenPathSegment(normalized)) {
    return `${basePath}?path=${encodeURIComponent(normalized)}`;
  }

  return `${basePath}/${encodeAssetPathForUrl(normalized)}`;
}

export function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Code file extensions (for icon display)
const CODE_FILE_EXTENSIONS = [
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  ".json",
  ".xml",
  ".svg",
  ".yaml",
  ".yml",
  ".astro",
  ".vue",
  ".svelte",
];

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
  // Check for code files
  const ext = item.name.substring(item.name.lastIndexOf(".")).toLowerCase();
  if (CODE_FILE_EXTENSIONS.includes(ext)) {
    return { icon: FileCode, className: "w-8 h-8 text-green-500" };
  }
  return { icon: File, className: "w-8 h-8 text-gray-500" };
}

export function getFileTreeIconComponent(item: AssetItem | FileTreeNode) {
  if (item.type === "folder") {
    return null;
  }

  if (item.isImage) {
    return { icon: ImageIcon, className: "text-muted-foreground" };
  }

  if (item.mimeType?.includes("pdf")) {
    return { icon: FileText, className: "text-muted-foreground" };
  }

  const ext = item.name.substring(item.name.lastIndexOf(".")).toLowerCase();
  if (CODE_FILE_EXTENSIONS.includes(ext)) {
    return { icon: FileCode, className: "text-muted-foreground" };
  }

  return { icon: File, className: "text-muted-foreground" };
}

export function buildImageUrl(
  projectSlug: string,
  version: number,
  path: string
): string {
  return buildAssetFileUrl(projectSlug, version, path);
}

export function buildAssetFileUrl(
  projectSlug: string,
  version: number,
  path: string
): string {
  return withVivdStudioTokenQuery(
    buildStudioFileRequestUrl(
      `/vivd-studio/api/assets/${encodeURIComponent(projectSlug)}/${version}`,
      path,
    ),
    getVivdStudioToken(),
  );
}

export function buildProjectFileUrl(
  projectSlug: string,
  version: number,
  path: string
): string {
  return withVivdStudioTokenQuery(
    buildStudioFileRequestUrl(
      `/vivd-studio/api/projects/${encodeURIComponent(projectSlug)}/v${version}`,
      path,
    ),
    getVivdStudioToken(),
  );
}

export function getStudioImageUrlCandidates(
  projectSlug: string,
  version: number,
  path: string,
): string[] {
  return Array.from(
    new Set([
      buildAssetFileUrl(projectSlug, version, path),
      buildProjectFileUrl(projectSlug, version, path),
    ]),
  );
}

export function getFileTreeIndentPx(depth: number): number {
  return depth * FILE_TREE_INDENT_STEP_PX + FILE_TREE_BASE_PADDING_PX;
}

export function isVivdInternalAssetPath(assetPath: string): boolean {
  const normalized = normalizeAssetPath(assetPath);
  return normalized === ".vivd" || normalized.startsWith(".vivd/");
}

export function canDragAssetToPreview(assetPath: string): boolean {
  return !isVivdInternalAssetPath(assetPath);
}

export function pickInitialAssetExplorerPath(options: {
  uploadsHasItems: boolean;
  publicImagesHasItems: boolean;
  imagesHasItems: boolean;
}): string {
  if (options.publicImagesHasItems || !options.imagesHasItems) {
    return "public/images";
  }

  return "images";
}

// Text file extensions that can be edited
const TEXT_FILE_EXTENSIONS = [
  // Web
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  // JavaScript/TypeScript variants
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  // Frameworks
  ".astro",
  ".vue",
  ".svelte",
  // Data formats
  ".json",
  ".xml",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
  // Documentation
  ".md",
  ".markdown",
  ".txt",
  ".rst",
  // Config files
  ".env",
  ".gitignore",
  ".npmignore",
  ".eslintrc",
  ".prettierrc",
  ".editorconfig",
  ".babelrc",
  ".browserslistrc",
  // Shell/scripts
  ".sh",
  ".bash",
  ".zsh",
  // Other
  ".lock",
  ".log",
];

// Check if a file is a text file that can be edited
export function isTextFile(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
  return TEXT_FILE_EXTENSIONS.includes(ext);
}
