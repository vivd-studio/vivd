import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getVersionDir, touchProjectUpdatedAt } from "../../generator/versionUtils";
import { hasDotSegment } from "../../generator/vivdPaths";
import path from "path";
import fs from "fs";
import sizeOf from "image-size";
import { safeJoin } from "../../fs/safePaths";
import { getMimeType, isImageFile, isTextFile } from "./shared";
import ignore from "ignore";

/**
 * Load and parse .gitignore file from a version directory.
 * Returns an ignore instance that can check if paths are ignored.
 */
function loadGitignore(versionDir: string) {
  const ig = ignore();
  const gitignorePath = path.join(versionDir, ".gitignore");

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    ig.add(content);
  }

  return ig;
}

export const assetsFilesystemProcedures = {
  /**
   * List files and folders in a project directory
   */
  listAssets: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string().optional().default(""),
      })
    )
    .query(async ({ input }) => {
      const { slug, version, relativePath } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }
      const versionDir = getVersionDir(slug, version);
      const targetDir = path.join(versionDir, relativePath);

      if (!fs.existsSync(targetDir)) {
        return { items: [], currentPath: relativePath };
      }

      // Security: ensure we're still within the version directory
      const realVersionDir = fs.realpathSync(versionDir);
      const realTargetDir = fs.realpathSync(targetDir);
      if (!realTargetDir.startsWith(realVersionDir)) {
        throw new Error("Invalid path");
      }

      const entries = fs.readdirSync(targetDir, { withFileTypes: true });

      // Dotfiles to show in the asset explorer
      const VISIBLE_DOTFILES = [".vivd", ".gitignore", ".env.example"];

      // Load gitignore for checking ignored status
      const ig = loadGitignore(versionDir);

      const items = entries
        .filter((entry) => !entry.name.startsWith(".") || VISIBLE_DOTFILES.includes(entry.name))
        .map((entry) => {
          const fullPath = path.join(targetDir, entry.name);
          const stats = fs.statSync(fullPath);
          const itemRelPath = path.join(relativePath, entry.name);
          // For directories, add trailing slash for gitignore matching
          const gitignorePath = entry.isDirectory() ? itemRelPath + "/" : itemRelPath;
          const isIgnored = ig.ignores(gitignorePath);

          if (entry.isDirectory()) {
            return {
              name: entry.name,
              type: "folder" as const,
              path: itemRelPath,
              isIgnored,
            };
          } else {
            const isImage = isImageFile(entry.name);
            let width: number | undefined;
            let height: number | undefined;

            // Read image dimensions if it's an image
            if (isImage) {
              try {
                const buffer = fs.readFileSync(fullPath);
                const dimensions = sizeOf(buffer);
                width = dimensions.width;
                height = dimensions.height;
              } catch {
                // Ignore errors reading dimensions (e.g., corrupt files, SVGs without viewBox)
              }
            }

            return {
              name: entry.name,
              type: "file" as const,
              path: itemRelPath,
              size: stats.size,
              mimeType: getMimeType(entry.name),
              isImage,
              isIgnored,
              width,
              height,
            };
          }
        })
        // Sort: folders first, then files, both alphabetically
        .sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "folder" ? -1 : 1;
        });

      return { items, currentPath: relativePath };
    }),

  /**
   * Delete a file or folder
   */
  deleteAsset: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, relativePath } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }
      const versionDir = getVersionDir(slug, version);
      const targetPath = path.join(versionDir, relativePath);

      if (!fs.existsSync(targetPath)) {
        throw new Error("File or folder not found");
      }

      // Security: ensure we're still within the version directory
      const realVersionDir = fs.realpathSync(versionDir);
      const realTargetPath = fs.realpathSync(targetPath);
      if (!realTargetPath.startsWith(realVersionDir)) {
        throw new Error("Invalid path");
      }

      // Prevent deleting critical files
      const basename = path.basename(relativePath);
      if (["index.html", "project.json", "manifest.json"].includes(basename)) {
        throw new Error("Cannot delete protected files");
      }

      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true });
      } else {
        fs.unlinkSync(targetPath);
      }

      touchProjectUpdatedAt(slug);
      return { success: true, deleted: relativePath };
    }),

  /**
   * Create a new folder
   */
  createFolder: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
        folderName: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, relativePath, folderName } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }
      const versionDir = getVersionDir(slug, version);

      // Sanitize folder name
      const sanitizedName = folderName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const rel = relativePath
        ? path.posix.join(relativePath.replace(/\\/g, "/"), sanitizedName)
        : sanitizedName;
      const sanitizedPath = safeJoin(versionDir, rel);

      if (fs.existsSync(sanitizedPath)) {
        throw new Error("Folder already exists");
      }

      fs.mkdirSync(sanitizedPath, { recursive: true });
      touchProjectUpdatedAt(slug);

      return {
        success: true,
        path: path.join(relativePath, sanitizedName),
        name: sanitizedName,
      };
    }),

  /**
   * Read the content of a text file
   */
  readTextFile: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
      })
    )
    .query(async ({ input }) => {
      const { slug, version, relativePath } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }
      const versionDir = getVersionDir(slug, version);
      const targetPath = path.join(versionDir, relativePath);

      if (!fs.existsSync(targetPath)) {
        throw new Error("File not found");
      }

      // Security: ensure we're still within the version directory
      const realVersionDir = fs.realpathSync(versionDir);
      const realTargetPath = fs.realpathSync(targetPath);
      if (!realTargetPath.startsWith(realVersionDir)) {
        throw new Error("Invalid path");
      }

      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) {
        throw new Error("Cannot read a directory");
      }

      // Check if it's a text file
      if (!isTextFile(relativePath)) {
        throw new Error("File is not a text file");
      }

      // Limit file size to 1MB for text editing
      if (stats.size > 1024 * 1024) {
        throw new Error("File is too large to edit (max 1MB)");
      }

      const content = fs.readFileSync(targetPath, "utf-8");
      return { content, encoding: "utf-8" };
    }),

  /**
   * Save content to a text file
   */
  saveTextFile: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
        content: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, relativePath, content } = input;
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }
      const versionDir = getVersionDir(slug, version);
      const targetPath = path.join(versionDir, relativePath);

      // Security: ensure we're still within the version directory
      // For new files, check the parent directory
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        throw new Error("Parent directory does not exist");
      }
      const realVersionDir = fs.realpathSync(versionDir);
      const realParentDir = fs.realpathSync(parentDir);
      if (!realParentDir.startsWith(realVersionDir)) {
        throw new Error("Invalid path");
      }

      // Check if it's a text file
      if (!isTextFile(relativePath)) {
        throw new Error("File is not a text file");
      }

      fs.writeFileSync(targetPath, content, "utf-8");
      touchProjectUpdatedAt(slug);
      return { success: true, path: relativePath };
    }),

  /**
   * Move a file or folder to a new location
   */
  moveAsset: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        sourcePath: z.string(),
        destinationPath: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, sourcePath, destinationPath } = input;

      // Validate paths
      if (hasDotSegment(sourcePath) || hasDotSegment(destinationPath)) {
        throw new Error("Invalid path");
      }

      const versionDir = getVersionDir(slug, version);
      const sourceFullPath = path.join(versionDir, sourcePath);
      const destFullPath = path.join(versionDir, destinationPath);

      // Check source exists
      if (!fs.existsSync(sourceFullPath)) {
        throw new Error("Source file or folder not found");
      }

      // Security: ensure paths stay within version directory
      const realVersionDir = fs.realpathSync(versionDir);
      const realSourcePath = fs.realpathSync(sourceFullPath);
      if (!realSourcePath.startsWith(realVersionDir)) {
        throw new Error("Invalid source path");
      }

      // Check destination parent exists
      const destParentDir = path.dirname(destFullPath);
      if (!fs.existsSync(destParentDir)) {
        throw new Error("Destination directory does not exist");
      }
      const realDestParentDir = fs.realpathSync(destParentDir);
      if (!realDestParentDir.startsWith(realVersionDir)) {
        throw new Error("Invalid destination path");
      }

      // Prevent moving protected files
      const basename = path.basename(sourcePath);
      if (["index.html", "project.json", "manifest.json"].includes(basename)) {
        throw new Error("Cannot move protected files");
      }

      // Check if destination already exists
      if (fs.existsSync(destFullPath)) {
        throw new Error("A file or folder already exists at the destination");
      }

      // Move the file/folder
      fs.renameSync(sourceFullPath, destFullPath);
      touchProjectUpdatedAt(slug);

      return { success: true, oldPath: sourcePath, newPath: destinationPath };
    }),

  /**
   * List all files and folders recursively for tree view
   */
  listAllAssets: projectMemberProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        rootPath: z.string().optional().default(""),
      })
    )
    .query(async ({ input }) => {
      const { slug, version, rootPath } = input;
      if (hasDotSegment(rootPath)) {
        throw new Error("Invalid path");
      }
      const versionDir = getVersionDir(slug, version);
      const targetDir = path.join(versionDir, rootPath);

      if (!fs.existsSync(targetDir)) {
        return { tree: [], rootPath };
      }

      // Security check
      const realVersionDir = fs.realpathSync(versionDir);
      const realTargetDir = fs.realpathSync(targetDir);
      if (!realTargetDir.startsWith(realVersionDir)) {
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

      // Dotfiles to show in the tree view
      const VISIBLE_DOTFILES_TREE = [".vivd", ".gitignore", ".env.example"];

      // Load gitignore for checking ignored status
      const ig = loadGitignore(versionDir);

      const buildTree = (dir: string, relativeTo: string): TreeNode[] => {
        if (!fs.existsSync(dir)) return [];

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const nodes: TreeNode[] = [];

        for (const entry of entries) {
          if (entry.name.startsWith(".") && !VISIBLE_DOTFILES_TREE.includes(entry.name)) continue;

          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativeTo, entry.name);
          // For directories, add trailing slash for gitignore matching
          const gitignorePath = entry.isDirectory() ? relPath + "/" : relPath;
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
            const isImage = isImageFile(entry.name);
            nodes.push({
              name: entry.name,
              type: "file",
              path: relPath,
              size: stats.size,
              mimeType: getMimeType(entry.name),
              isImage,
              isIgnored,
            });
          }
        }

        // Sort: folders first, then files, both alphabetically
        return nodes.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "folder" ? -1 : 1;
        });
      };

      const tree = buildTree(targetDir, rootPath);
      return { tree, rootPath };
    }),
};
