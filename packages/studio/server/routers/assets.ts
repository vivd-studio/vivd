import { z } from "zod";
import { router, publicProcedure } from "../trpc/trpc.js";
import path from "path";
import fs from "fs";
import sizeOf from "image-size";
import ignore from "ignore";
import sharp from "sharp";
import { WEBP_QUALITY } from "../config.js";

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

// AI Image helper functions
const IMAGE_EDITING_MODEL =
  process.env.IMAGE_EDITING_MODEL || "google/gemini-3-pro-image-preview";
const HERO_GENERATION_MODEL =
  process.env.HERO_GENERATION_MODEL || "google/gemini-3-pro-image-preview";
const BACKGROUND_REMOVAL_MODEL =
  process.env.BACKGROUND_REMOVAL_MODEL || "openai/gpt-5-image";

async function callOpenRouter(body: any): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/vivd",
      "X-Title": "Vivd",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${error}`);
  }

  return response.json();
}

function extractImageFromResponse(result: any): string | null {
  if (!result.choices || !result.choices[0]) {
    return null;
  }

  const message = result.choices[0].message;

  // Check for images in the OpenRouter format
  if (message.images && message.images.length > 0) {
    const imgObj = message.images[0];
    const imageUrl = imgObj.image_url?.url || imgObj.imageUrl?.url;
    if (imageUrl) {
      return imageUrl;
    }
  }

  // Fallback: check content for markdown or URL
  if (message.content) {
    let content = "";
    if (typeof message.content === "string") {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
    }

    // Check for Markdown image link ![alt](url)
    const match = content.match(/\!\[.*?\]\((.*?)\)/);
    if (match) return match[1];
    if (content.startsWith("http")) return content;
  }

  return null;
}

async function saveGeneratedImage(
  imageUrl: string,
  filepath: string
): Promise<void> {
  let buffer: Buffer;

  if (imageUrl.startsWith("http")) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } else if (imageUrl.startsWith("data:image")) {
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
    buffer = Buffer.from(base64Data, "base64");
  } else {
    buffer = Buffer.from(imageUrl, "base64");
  }

  // Create parent directory if needed
  const parentDir = path.dirname(filepath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Convert to WebP if filepath ends in .webp
  if (filepath.endsWith(".webp")) {
    await sharp(buffer).webp({ quality: WEBP_QUALITY }).toFile(filepath);
  } else {
    fs.writeFileSync(filepath, buffer);
  }
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
   * AI image editing - sends the image to the generation model with edit instructions
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
    .mutation(async ({ input, ctx }) => {
      const { relativePath, prompt } = input;

      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }

      const projectDir = ctx.workspace.getProjectPath();
      const imagePath = path.join(projectDir, relativePath);

      // Validate image exists
      if (!fs.existsSync(imagePath)) {
        throw new Error("Image not found");
      }

      // Security: ensure we're within the project directory
      const realProjectDir = fs.realpathSync(projectDir);
      const realImagePath = fs.realpathSync(imagePath);
      if (!realImagePath.startsWith(realProjectDir)) {
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

      const editPrompt = `Edit this image according to the following instructions: ${prompt}`;

      console.log(
        `[AI Edit] Editing image: ${relativePath} with prompt: ${prompt}`
      );
      console.log(
        `[AI Edit] Image size: ${imageBuffer.length} bytes, MIME: image/${mimeType}`
      );

      try {
        const result = await callOpenRouter({
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
        });

        const imageUrl = extractImageFromResponse(result);

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

        // Find a unique filename
        let suffix = "-ai-edited";
        let counter = 1;
        let newFileName = `${nameWithoutExt}${suffix}.webp`;
        let newFilePath = path.join(projectDir, originalDir, newFileName);

        while (fs.existsSync(newFilePath)) {
          counter++;
          newFileName = `${nameWithoutExt}${suffix}-${counter}.webp`;
          newFilePath = path.join(projectDir, originalDir, newFileName);
        }

        // Save the image
        await saveGeneratedImage(imageUrl, newFilePath);

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
        throw new Error(`Failed to edit image: ${error.message}`);
      }
    }),

  /**
   * AI image creation - generates an image from a prompt with optional reference images
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
    .mutation(async ({ input, ctx }) => {
      const { prompt, referenceImages, targetPath } = input;

      const projectDir = ctx.workspace.getProjectPath();

      // Validate projectDir exists
      if (!fs.existsSync(projectDir)) {
        throw new Error("Project directory not found");
      }

      let saveDir: string;
      try {
        saveDir = safeJoin(projectDir, targetPath);
      } catch {
        throw new Error("Invalid path");
      }

      // Build the messages array with prompt and optional reference images
      const messages: any[] = [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ];

      // Add reference images
      for (const imgPath of referenceImages) {
        let fullPath: string;
        try {
          fullPath = safeJoin(projectDir, imgPath);
        } catch {
          throw new Error("Invalid path");
        }
        if (fs.existsSync(fullPath) && isImageFile(fullPath)) {
          const buffer = fs.readFileSync(fullPath);
          const base64 = buffer.toString("base64");
          const ext = path.extname(fullPath).substring(1).toLowerCase();
          const mimeType =
            ext === "svg" ? "svg+xml" : ext === "jpg" ? "jpeg" : ext;

          messages[0].content.push({
            type: "image_url",
            image_url: {
              url: `data:image/${mimeType};base64,${base64}`,
            },
          });
        }
      }

      console.log(
        `[AI Create] Creating image with prompt: ${prompt.substring(0, 100)}...`
      );
      console.log(
        `[AI Create] Reference images: ${referenceImages.join(", ") || "none"}`
      );

      try {
        const result = await callOpenRouter({
          model: HERO_GENERATION_MODEL,
          messages: messages,
          modalities: ["image", "text"],
        });

        const imageUrl = extractImageFromResponse(result);

        if (!imageUrl) {
          throw new Error("Failed to generate image - no image in response");
        }

        // Generate filename from prompt (sanitized)
        const sanitizedPrompt = prompt
          .substring(0, 30)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");

        const timestamp = Date.now();
        const newFileName = `ai-${sanitizedPrompt}-${timestamp}.webp`;

        // Determine save path
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
        }

        const newFilePath = path.join(saveDir, newFileName);

        // Save the image
        await saveGeneratedImage(imageUrl, newFilePath);

        const normalizedTarget = targetPath
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "");
        const newRelativePath = normalizedTarget
          ? path.posix.join(normalizedTarget, newFileName)
          : newFileName;
        console.log(`[AI Create] Saved new image to: ${newRelativePath}`);

        return {
          success: true,
          path: newRelativePath,
          fileName: newFileName,
        };
      } catch (error: any) {
        console.error(`[AI Create] Error:`, error.message);
        throw new Error(`Failed to create image: ${error.message}`);
      }
    }),
});
