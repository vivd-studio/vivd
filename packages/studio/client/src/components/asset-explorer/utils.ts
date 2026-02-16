import {
  Folder,
  File,
  FileText,
  FileCode,
  Image as ImageIcon,
} from "lucide-react";
import type { AssetItem } from "./types";

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

export function buildImageUrl(
  projectSlug: string,
  version: number,
  path: string
): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const encodedPath = normalized
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/vivd-studio/api/projects/${encodeURIComponent(projectSlug)}/v${version}/${encodedPath}`;
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
