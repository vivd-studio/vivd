import path from "path";

// Get MIME type from extension
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".txt": "text/plain",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// Check if a file is an image
export function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].includes(ext);
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
  const ext = path.extname(filename).toLowerCase();
  const basename = path.basename(filename).toLowerCase();

  // Check extension
  if (TEXT_FILE_EXTENSIONS.includes(ext)) {
    return true;
  }

  // Check for dotfiles without extension
  if (
    basename.startsWith(".") &&
    [".gitignore", ".env", ".env.local", ".env.example"].includes(basename)
  ) {
    return true;
  }

  return false;
}
