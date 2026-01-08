import { z } from "zod";
import { adminProcedure } from "../../trpc";
import { getVersionDir } from "../../generator/versionUtils";
import { hasDotSegment } from "../../generator/vivdPaths";
import path from "path";
import fs from "fs";
import axios from "axios";
import {
  OPENROUTER_API_KEY,
  IMAGE_EDITING_MODEL,
  HERO_GENERATION_MODEL,
} from "../../generator/config";
import { downloadImage, saveImageBuffer } from "../../generator/utils";
import { safeJoin } from "../../fs/safePaths";
import { isImageFile } from "./shared";

export const assetsAiImageProcedures = {
  /**
   * Edit an image with AI - sends the image to the generation model with edit instructions
   */
  editImageWithAI: adminProcedure
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
      if (hasDotSegment(relativePath)) {
        throw new Error("Invalid path");
      }
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
      const editPrompt = `Edit this image according to the following instructions: ${prompt}`;

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
              "HTTP-Referer": "https://github.com/vivd",
              "X-Title": "Vivd",
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

  /**
   * Create a new image with AI - generates an image from a prompt with optional reference images
   */
  createImageWithAI: adminProcedure
    .input(
      z.object({
        slug: z.string(),
        version: z.number(),
        prompt: z.string().min(1), // generation prompt
        referenceImages: z.array(z.string()).optional().default([]), // paths to reference images
        targetPath: z.string().optional().default(""), // where to save the image (relative path)
      })
    )
    .mutation(async ({ input }) => {
      const { slug, version, prompt, referenceImages, targetPath } = input;
      const versionDir = getVersionDir(slug, version);

      // Validate versionDir exists
      if (!fs.existsSync(versionDir)) {
        throw new Error("Project version not found");
      }

      let saveDir: string;
      try {
        saveDir = safeJoin(versionDir, targetPath);
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
          fullPath = safeJoin(versionDir, imgPath);
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
        const response = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model: HERO_GENERATION_MODEL,
            messages: messages,
            modalities: ["image", "text"],
          },
          {
            headers: {
              Authorization: `Bearer ${OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/vivd",
              "X-Title": "Vivd",
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
        if (error.response?.data) {
          console.error(
            `[AI Create] Response:`,
            JSON.stringify(error.response.data)
          );
        }
        throw new Error(`Failed to create image: ${error.message}`);
      }
    }),
};
