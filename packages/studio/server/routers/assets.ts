import { z } from "zod";
import { router, publicProcedure } from "../trpc/trpc.js";
import path from "path";
import fs from "fs";
import sizeOf from "image-size";
import ignore from "ignore";

function safeJoin(root: string, targetPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Invalid path");
  }

  return resolvedTarget;
}

// Dotfiles that are allowed in asset paths
const ALLOWED_DOTFILES = [".vivd", ".gitignore", ".env.example"];

function hasDotSegment(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.some(
    (segment) =>
      segment.startsWith(".") && !ALLOWED_DOTFILES.includes(segment)
  );
}

function getMimeType(filename: string): string {
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

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"].includes(
    ext
  );
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

function isTextFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const basename = path.basename(filename).toLowerCase();

  if (TEXT_FILE_EXTENSIONS.includes(ext)) {
    return true;
  }

  // Dotfiles without extension
  return (
    basename.startsWith(".") &&
    [".gitignore", ".env", ".env.local", ".env.example"].includes(basename)
  );
}

function loadGitignore(projectDir: string) {
  const ig = ignore();
  const gitignorePath = path.join(projectDir, ".gitignore");

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    ig.add(content);
  }

  return ig;
}

export const assetsRouter = router({
  /**
   * List files and folders in a project directory
   */
  listAssets: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string().optional().default(""),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return { items: [], currentPath: input.relativePath ?? "" };
      }

      const { relativePath } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const targetDir = path.join(projectDir, relativePath);

      if (!fs.existsSync(targetDir)) {
        return { items: [], currentPath: relativePath };
      }

      // Security: ensure we're still within the workspace directory
      const realProjectDir = fs.realpathSync(projectDir);
      const realTargetDir = fs.realpathSync(targetDir);
      if (!realTargetDir.startsWith(realProjectDir)) {
        throw new Error("Invalid path");
      }

      const entries = fs.readdirSync(targetDir, { withFileTypes: true });

      // Dotfiles to show in the asset explorer
      const VISIBLE_DOTFILES = [".vivd", ".gitignore", ".env.example"];

      // Load gitignore for checking ignored status
      const ig = loadGitignore(projectDir);

      const items = entries
        .filter(
          (entry) =>
            !entry.name.startsWith(".") || VISIBLE_DOTFILES.includes(entry.name)
        )
        .map((entry) => {
          const fullPath = path.join(targetDir, entry.name);
          const stats = fs.statSync(fullPath);
          const itemRelPath = path.join(relativePath, entry.name);
          const gitignorePath = entry.isDirectory()
            ? `${itemRelPath}/`
            : itemRelPath;
          const isIgnored = ig.ignores(gitignorePath);

          if (entry.isDirectory()) {
            return {
              name: entry.name,
              type: "folder" as const,
              path: itemRelPath,
              isIgnored,
            };
          }

          const image = isImageFile(entry.name);
          let width: number | undefined;
          let height: number | undefined;

          if (image) {
            try {
              const buffer = fs.readFileSync(fullPath);
              const dimensions = sizeOf(buffer);
              width = dimensions.width;
              height = dimensions.height;
            } catch {
              // ignore
            }
          }

          return {
            name: entry.name,
            type: "file" as const,
            path: itemRelPath,
            size: stats.size,
            mimeType: getMimeType(entry.name),
            isImage: image,
            isIgnored,
            width,
            height,
          };
        })
        .sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "folder" ? -1 : 1;
        });

      return { items, currentPath: relativePath };
    }),

  /**
   * Delete a file or folder
   */
  deleteAsset: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const { relativePath } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const targetPath = path.join(projectDir, relativePath);

      if (!fs.existsSync(targetPath)) {
        throw new Error("File or folder not found");
      }

      const realProjectDir = fs.realpathSync(projectDir);
      const realTargetPath = fs.realpathSync(targetPath);
      if (!realTargetPath.startsWith(realProjectDir)) {
        throw new Error("Invalid path");
      }

      // Prevent deleting critical files
      const basename = path.basename(relativePath);
      if (["index.html", "project.json", "manifest.json"].includes(basename)) {
        throw new Error("Cannot delete protected files");
      }

      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.rmSync(targetPath, { force: true });
      }

      return { success: true, deleted: relativePath };
    }),

  /**
   * Create a new folder
   */
  createFolder: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
        folderName: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const { relativePath, folderName } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();

      // Sanitize folder name
      const sanitizedName = folderName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const rel = relativePath
        ? path.posix.join(relativePath.replace(/\\/g, "/"), sanitizedName)
        : sanitizedName;
      const fullPath = safeJoin(projectDir, rel);

      if (fs.existsSync(fullPath)) {
        throw new Error("Folder already exists");
      }

      fs.mkdirSync(fullPath, { recursive: true });

      return {
        success: true,
        path: path.join(relativePath, sanitizedName),
        name: sanitizedName,
      };
    }),

  /**
   * Read the content of a text file
   */
  readTextFile: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const { relativePath } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const targetPath = path.join(projectDir, relativePath);

      if (!fs.existsSync(targetPath)) {
        throw new Error("File not found");
      }

      const realProjectDir = fs.realpathSync(projectDir);
      const realTargetPath = fs.realpathSync(targetPath);
      if (!realTargetPath.startsWith(realProjectDir)) {
        throw new Error("Invalid path");
      }

      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) {
        throw new Error("Cannot read a directory");
      }

      if (!isTextFile(relativePath)) {
        throw new Error("File is not a text file");
      }

      if (stats.size > 1024 * 1024) {
        throw new Error("File is too large to edit (max 1MB)");
      }

      const content = fs.readFileSync(targetPath, "utf-8");
      return { content, encoding: "utf-8" };
    }),

  /**
   * Save content to a text file
   */
  saveTextFile: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
        content: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const { relativePath, content } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const targetPath = path.join(projectDir, relativePath);

      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        throw new Error("Parent directory does not exist");
      }

      const realProjectDir = fs.realpathSync(projectDir);
      const realParentDir = fs.realpathSync(parentDir);
      if (!realParentDir.startsWith(realProjectDir)) {
        throw new Error("Invalid path");
      }

      if (!isTextFile(relativePath)) {
        throw new Error("File is not a text file");
      }

      fs.writeFileSync(targetPath, content, "utf-8");
      return { success: true, path: relativePath };
    }),

  /**
   * Move a file or folder to a new location
   */
  moveAsset: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        sourcePath: z.string(),
        destinationPath: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        throw new Error("Workspace not initialized");
      }

      const { sourcePath, destinationPath } = input;
      if (hasDotSegment(sourcePath) || hasDotSegment(destinationPath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const sourceFullPath = path.join(projectDir, sourcePath);
      const destFullPath = path.join(projectDir, destinationPath);

      if (!fs.existsSync(sourceFullPath)) {
        throw new Error("Source file or folder not found");
      }

      const realProjectDir = fs.realpathSync(projectDir);
      const realSourcePath = fs.realpathSync(sourceFullPath);
      if (!realSourcePath.startsWith(realProjectDir)) {
        throw new Error("Invalid source path");
      }

      const destParentDir = path.dirname(destFullPath);
      if (!fs.existsSync(destParentDir)) {
        throw new Error("Destination directory does not exist");
      }
      const realDestParentDir = fs.realpathSync(destParentDir);
      if (!realDestParentDir.startsWith(realProjectDir)) {
        throw new Error("Invalid destination path");
      }

      const basename = path.basename(sourcePath);
      if (["index.html", "project.json", "manifest.json"].includes(basename)) {
        throw new Error("Cannot move protected files");
      }

      if (fs.existsSync(destFullPath)) {
        throw new Error("A file or folder already exists at the destination");
      }

      fs.renameSync(sourceFullPath, destFullPath);
      return { success: true, oldPath: sourcePath, newPath: destinationPath };
    }),

  /**
   * List all files and folders recursively for tree view
   */
  listAllAssets: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        rootPath: z.string().optional().default(""),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return { tree: [], rootPath: input.rootPath ?? "" };
      }

      const { rootPath } = input;
      if (hasDotSegment(rootPath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const targetDir = path.join(projectDir, rootPath);

      if (!fs.existsSync(targetDir)) {
        return { tree: [], rootPath };
      }

      const realProjectDir = fs.realpathSync(projectDir);
      const realTargetDir = fs.realpathSync(targetDir);
      if (!realTargetDir.startsWith(realProjectDir)) {
        throw new Error("Invalid path");
      }

      interface TreeNode {
        name: string;
        type: "file" | "folder";
        path: string;
        children?: TreeNode[];
        size?: number;
        mimeType?: string;
        isImage?: boolean;
        isIgnored?: boolean;
      }

      const VISIBLE_DOTFILES_TREE = [".vivd", ".gitignore", ".env.example"];
      const ig = loadGitignore(projectDir);

      const buildTree = (dir: string, relativeTo: string): TreeNode[] => {
        if (!fs.existsSync(dir)) return [];

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const nodes: TreeNode[] = [];

        for (const entry of entries) {
          if (
            entry.name.startsWith(".") &&
            !VISIBLE_DOTFILES_TREE.includes(entry.name)
          ) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativeTo, entry.name);
          const gitignorePath = entry.isDirectory()
            ? `${relPath}/`
            : relPath;
          const isIgnored = ig.ignores(gitignorePath);

          if (entry.isDirectory()) {
            nodes.push({
              name: entry.name,
              type: "folder",
              path: relPath,
              children: buildTree(fullPath, relPath),
              isIgnored,
            });
          } else {
            const stats = fs.statSync(fullPath);
            nodes.push({
              name: entry.name,
              type: "file",
              path: relPath,
              size: stats.size,
              mimeType: getMimeType(entry.name),
              isImage: isImageFile(entry.name),
              isIgnored,
            });
          }
        }

        return nodes.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "folder" ? -1 : 1;
        });
      };

      const tree = buildTree(targetDir, rootPath);
      return { tree, rootPath };
    }),

  /**
   * AI image editing (not yet supported in standalone studio)
   */
  editImageWithAI: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
        prompt: z.string().min(1),
      })
    )
    .mutation(async () => {
      throw new Error("AI image editing is not enabled in standalone studio");
    }),

  /**
   * AI image creation (not yet supported in standalone studio)
   */
  createImageWithAI: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        prompt: z.string().min(1),
        referenceImages: z.array(z.string()).optional().default([]),
        targetPath: z.string().optional().default(""),
      })
    )
    .mutation(async () => {
      throw new Error("AI image generation is not enabled in standalone studio");
    }),
});
