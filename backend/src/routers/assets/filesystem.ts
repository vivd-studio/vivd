import { z } from "zod";
import { projectMemberProcedure } from "../../trpc";
import { getVersionDir } from "../../generator/versionUtils";
import { hasDotSegment } from "../../generator/vivdPaths";
import path from "path";
import fs from "fs";
import sizeOf from "image-size";
import { safeJoin } from "../../fs/safePaths";
import { getMimeType, isImageFile } from "./shared";

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

      const items = entries
        .filter((entry) => !entry.name.startsWith(".")) // Hide hidden files
        .map((entry) => {
          const fullPath = path.join(targetDir, entry.name);
          const stats = fs.statSync(fullPath);

          if (entry.isDirectory()) {
            return {
              name: entry.name,
              type: "folder" as const,
              path: path.join(relativePath, entry.name),
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
              path: path.join(relativePath, entry.name),
              size: stats.size,
              mimeType: getMimeType(entry.name),
              isImage,
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

      return {
        success: true,
        path: path.join(relativePath, sanitizedName),
        name: sanitizedName,
      };
    }),
};
