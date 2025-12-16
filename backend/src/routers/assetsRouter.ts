import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { getVersionDir } from "../generator/versionUtils";
import path from "path";
import fs from "fs";
import axios from "axios";
import { OPENROUTER_API_KEY, IMAGE_EDITING_MODEL } from "../generator/config";
import { downloadImage, saveImageBuffer } from "../generator/utils";

// Get MIME type from extension
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

// Check if a file is an image
function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].includes(ext);
}

export const assetsRouter = router({
  /**
   * List files and folders in a project directory
   */
  listAssets: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string().optional().default(""),
      })
    )
    .query(async ({ input }) => {
      const { slug, version, relativePath } = input;
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
            return {
              name: entry.name,
              type: "file" as const,
              path: path.join(relativePath, entry.name),
              size: stats.size,
              mimeType: getMimeType(entry.name),
              isImage: isImageFile(entry.name),
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
  deleteAsset: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, relativePath } = input;
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
  createFolder: protectedProcedure
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
      const versionDir = getVersionDir(slug, version);
      const targetDir = path.join(versionDir, relativePath, folderName);

      // Sanitize folder name
      const sanitizedName = folderName.replace(/[^a-zA-Z0-9_-]/g, "_");
      const sanitizedPath = path.join(versionDir, relativePath, sanitizedName);

      // Security: ensure we're still within the version directory
      if (!sanitizedPath.startsWith(versionDir)) {
        throw new Error("Invalid path");
      }

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

  /**
   * Edit an image with AI - sends the image to the generation model with edit instructions
   */
  editImageWithAI: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        relativePath: z.string(), // path to the image file
        prompt: z.string().min(1), // edit instructions
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, relativePath, prompt } = input;
      const versionDir = getVersionDir(slug, version);
      const imagePath = path.join(versionDir, relativePath);

      // Validate image exists
      if (!fs.existsSync(imagePath)) {
        throw new Error("Image not found");
      }

      // Security: ensure we're within the version directory
      const realVersionDir = fs.realpathSync(versionDir);
      const realImagePath = fs.realpathSync(imagePath);
      if (!realImagePath.startsWith(realVersionDir)) {
        throw new Error("Invalid path");
      }

      // Validate it's actually an image
      if (!isImageFile(imagePath)) {
        throw new Error("File is not an image");
      }

      // Read and encode the image
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");
      const ext = path.extname(imagePath).substring(1).toLowerCase();
      const mimeType = ext === "svg" ? "svg+xml" : ext === "jpg" ? "jpeg" : ext;

      // Build the prompt for editing
      const editPrompt = `Edit this image according to the following instructions: ${prompt}

Keep the overall composition and style similar to the original image, but apply the requested changes.`;

      // Call the image generation model
      console.log(
        `[AI Edit] Editing image: ${relativePath} with prompt: ${prompt}`
      );
      console.log(
        `[AI Edit] Image size: ${imageBuffer.length} bytes, MIME: image/${mimeType}`
      );

      try {
        const response = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model: IMAGE_EDITING_MODEL,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: editPrompt },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/${mimeType};base64,${base64Image}`,
                    },
                  },
                ],
              },
            ],
            modalities: ["image", "text"],
          },
          {
            headers: {
              Authorization: `Bearer ${OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/landing-page-agent",
              "X-Title": "Landing Page Agent",
            },
          }
        );

        const result = response.data;
        let imageUrl: string | null = null;

        if (result.choices && result.choices[0]) {
          const message = result.choices[0].message;

          // Check for images in the OpenRouter format
          if (message.images && message.images.length > 0) {
            const imgObj = message.images[0];
            imageUrl = imgObj.image_url?.url || imgObj.imageUrl?.url;
          }

          // Fallback: check content for markdown or URL
          if (!imageUrl && message.content) {
            let content = "";
            if (typeof message.content === "string") {
              content = message.content;
            } else if (Array.isArray(message.content)) {
              content = message.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("");
            }

            const match = content.match(/\!\[.*?\]\((.*?)\)/);
            if (match) imageUrl = match[1];
            else if (content.startsWith("http")) imageUrl = content;
          }
        }

        if (!imageUrl) {
          throw new Error(
            "Failed to generate edited image - no image in response"
          );
        }

        // Generate new filename with -ai-edited suffix
        const originalName = path.basename(relativePath);
        const originalDir = path.dirname(relativePath);
        const extIndex = originalName.lastIndexOf(".");
        const nameWithoutExt =
          extIndex > 0 ? originalName.substring(0, extIndex) : originalName;
        const originalExt =
          extIndex > 0 ? originalName.substring(extIndex) : ".webp";

        // Find a unique filename
        let suffix = "-ai-edited";
        let counter = 1;
        let newFileName = `${nameWithoutExt}${suffix}${originalExt}`;
        let newFilePath = path.join(versionDir, originalDir, newFileName);

        while (fs.existsSync(newFilePath)) {
          counter++;
          newFileName = `${nameWithoutExt}${suffix}-${counter}${originalExt}`;
          newFilePath = path.join(versionDir, originalDir, newFileName);
        }

        // Download or save the image
        if (imageUrl.startsWith("http")) {
          await downloadImage(imageUrl, newFilePath);
        } else {
          // Handle base64
          let buffer: Buffer;
          if (imageUrl.startsWith("data:image")) {
            const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
            buffer = Buffer.from(base64Data, "base64");
          } else {
            buffer = Buffer.from(imageUrl, "base64");
          }
          await saveImageBuffer(buffer, newFilePath);
        }

        const newRelativePath = path.join(originalDir, newFileName);
        console.log(`[AI Edit] Saved edited image to: ${newRelativePath}`);

        return {
          success: true,
          originalPath: relativePath,
          newPath: newRelativePath,
          fileName: newFileName,
        };
      } catch (error: any) {
        console.error(`[AI Edit] Error:`, error.message);
        if (error.response?.data) {
          console.error(
            `[AI Edit] Response:`,
            JSON.stringify(error.response.data)
          );
        }
        throw new Error(`Failed to edit image: ${error.message}`);
      }
    }),
});
