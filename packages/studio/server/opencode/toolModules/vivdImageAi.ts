import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { isConnectedMode } from "@vivd/shared";
import { WEBP_QUALITY } from "../../config.js";
import {
  createImageGeneration,
  extractImageFromResponse,
} from "../../services/integrations/OpenRouterImageService.js";
import { projectTouchReporter } from "../../services/reporting/ProjectTouchReporter.js";
import { usageReporter } from "../../services/reporting/UsageReporter.js";
import { requestBucketSync } from "../../services/sync/AgentTaskSyncService.js";
import type { OpencodeToolDefinition } from "./types.js";

const DEFAULT_IMAGE_MODEL = "google/gemini-3-pro-image-preview";
const IMAGE_EDITING_MODEL =
  (process.env.IMAGE_EDITING_MODEL || "").trim() || DEFAULT_IMAGE_MODEL;
const IMAGE_CREATION_MODEL =
  (process.env.HERO_GENERATION_MODEL || "").trim() || DEFAULT_IMAGE_MODEL;
const MAX_INPUT_IMAGES = 5;
const DEFAULT_OUTPUT_DIR = "images";
const ASTRO_OUTPUT_DIR = "src/content/media";
const IMAGE_DOWNLOAD_TIMEOUT_MS =
  Number.parseInt(process.env.VIVD_IMAGE_AI_DOWNLOAD_TIMEOUT_MS || "", 10) || 600_000;
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
]);

type ImageOperation = "auto" | "create" | "edit";

interface ResolvedImageInput {
  absolutePath: string;
  relativePath: string;
  mimeType: string;
  base64: string;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}

function normalizeRelativePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  return normalized;
}

function normalizeDirectoryPath(inputPath: string): string {
  return inputPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

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

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
  };
  return mimeMap[ext] || "application/octet-stream";
}

function sanitizeForFilename(input: string, maxLength = 40): string {
  const sanitized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/, "");
  return sanitized || "image";
}

function ensureUniqueFilePath(filePath: string): string {
  if (!fs.existsSync(filePath)) return filePath;

  const parsed = path.parse(filePath);
  let index = 2;
  let candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
  }
  return candidate;
}

async function decodeGeneratedImage(imagePayload: string): Promise<Buffer> {
  if (imagePayload.startsWith("http")) {
    let response: Response;
    try {
      response = await fetch(imagePayload, {
        signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(
          `Timed out downloading generated image after ${IMAGE_DOWNLOAD_TIMEOUT_MS}ms.`,
        );
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  if (imagePayload.startsWith("data:image")) {
    const base64Data = imagePayload.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
    return Buffer.from(base64Data, "base64");
  }

  return Buffer.from(imagePayload, "base64");
}

function buildPrompt(
  prompt: string,
  operation: Exclude<ImageOperation, "auto">,
  imageCount: number,
): string {
  if (operation === "edit") {
    if (imageCount > 1) {
      return `Edit the first image using this request: ${prompt}. Use the additional images as visual references.`;
    }
    return `Edit this image using this request: ${prompt}.`;
  }

  if (imageCount > 0) {
    return `Create a new image using this request: ${prompt}. Use the provided images as references.`;
  }

  return prompt;
}

function resolveOutputDirectory(
  projectDir: string,
  outputDir: string,
  operation: Exclude<ImageOperation, "auto">,
  firstImagePath: string | undefined,
): string {
  const normalizedOutputDir = normalizeDirectoryPath(outputDir);
  if (normalizedOutputDir) return normalizedOutputDir;

  if (operation === "edit" && firstImagePath) {
    const imageDir = path.posix.dirname(normalizeRelativePath(firstImagePath));
    return imageDir === "." ? "" : imageDir;
  }

  const astroConfigCandidates = [
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.ts",
    "astro.config.cjs",
    "astro.config.mts",
  ];
  const hasAstroConfig = astroConfigCandidates.some((candidate) =>
    fs.existsSync(path.join(projectDir, candidate)),
  );
  if (hasAstroConfig) return ASTRO_OUTPUT_DIR;

  const publicImagesAbsolute = path.join(projectDir, ASTRO_OUTPUT_DIR);
  if (fs.existsSync(publicImagesAbsolute) && fs.statSync(publicImagesAbsolute).isDirectory()) {
    return ASTRO_OUTPUT_DIR;
  }

  return DEFAULT_OUTPUT_DIR;
}

async function getImageGenerationLimitError(): Promise<string | null> {
  if (!isConnectedMode()) return null;

  const status = await usageReporter.fetchStatus();
  if (!status) {
    return "Unable to verify Studio usage status with the backend. Image generation is temporarily unavailable. Please try again later.";
  }

  if (status.blocked || status.imageGenBlocked) {
    const warning = status.warnings.find((entry) =>
      entry.toLowerCase().includes("image"),
    );
    if (warning) return warning;

    if (status.imageGenBlocked) {
      return `Image generation limit reached: ${status.usage.imageGen.current}/${status.usage.imageGen.limit} images this month`;
    }

    return status.warnings[0] ?? "Usage limit exceeded.";
  }

  return null;
}

const vivdImageAiArgs = {
  prompt: z
    .string()
    .min(1)
    .max(4_000)
    .describe("The image instruction prompt."),
  images: z
    .array(z.string().min(1))
    .max(MAX_INPUT_IMAGES)
    .default([])
    .describe(
      "Optional input image paths (relative to project root). Up to 5 images. In edit mode, first image is the primary source and additional images are references.",
    ),
  operation: z
    .enum(["auto", "create", "edit"])
    .default("auto")
    .describe(
      "Use 'auto' to choose based on image inputs. 'create' generates a new image. 'edit' transforms the first input image and can use additional references.",
    ),
  outputDir: z
    .string()
    .default("")
    .describe(
      "Optional output directory (relative to project root). Defaults to source image directory for edits, or auto-detected src/content/media (Astro) vs images/ for prompt-only creates.",
    ),
};

type VivdImageAiArgs = z.infer<z.ZodObject<typeof vivdImageAiArgs>>;

export const vivdImageAiToolDefinition: OpencodeToolDefinition<typeof vivdImageAiArgs> = {
  description:
    "Create or edit images with Vivd's OpenRouter image models. Works with prompt-only generation or up to 5 input images for edits, quality improvements, upscales, and reference-based variations.",
  args: vivdImageAiArgs,
  async execute(args: VivdImageAiArgs, context) {
    const toolName = "vivd_image_ai";
    const startedAt = Date.now();
    const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
    if (!apiKey) {
      return JSON.stringify(
        {
          tool: toolName,
          ok: false,
          error: {
            code: "MISSING_OPENROUTER_API_KEY",
            message: "OPENROUTER_API_KEY is not set in the Studio runtime.",
          },
        },
        null,
        2,
      );
    }

    const prompt = args.prompt.trim();
    const requestedOperation = args.operation;
    const dedupedImages = Array.from(
      new Set(args.images.map((entry) => normalizeRelativePath(entry.trim())).filter(Boolean)),
    );

    if (requestedOperation === "edit" && dedupedImages.length === 0) {
      return JSON.stringify(
        {
          tool: toolName,
          ok: false,
          error: {
            code: "BAD_REQUEST",
            message: "operation='edit' requires at least one image input.",
          },
        },
        null,
        2,
      );
    }

    const operation: Exclude<ImageOperation, "auto"> =
      requestedOperation === "auto"
        ? dedupedImages.length > 0
          ? "edit"
          : "create"
        : requestedOperation;

    console.log(
      `[${toolName}] start op=${operation} cwd=${context.directory} inputs=${dedupedImages.length} promptLen=${prompt.length} outputDir=${args.outputDir.trim() || "(default)"}`,
    );

    const imageGenLimitError = await getImageGenerationLimitError();
    if (imageGenLimitError) {
      console.warn(`[${toolName}] blocked by usage limit: ${imageGenLimitError}`);
      return JSON.stringify(
        {
          tool: toolName,
          ok: false,
          operation,
          error: {
            code: "IMAGE_GEN_LIMIT_EXCEEDED",
            message: imageGenLimitError,
          },
        },
        null,
        2,
      );
    }

    try {
      const resolvedInputs: ResolvedImageInput[] = dedupedImages.map((imagePath) => {
        const absolutePath = safeJoin(context.directory, imagePath);
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
          throw new Error(`Image not found: ${imagePath}`);
        }
        if (!isImageFile(absolutePath)) {
          throw new Error(`File is not a supported image: ${imagePath}`);
        }

        const buffer = fs.readFileSync(absolutePath);
        return {
          absolutePath,
          relativePath: imagePath,
          mimeType: getMimeType(absolutePath),
          base64: buffer.toString("base64"),
        };
      });

      const model = operation === "edit" ? IMAGE_EDITING_MODEL : IMAGE_CREATION_MODEL;
      const textPrompt = buildPrompt(prompt, operation, resolvedInputs.length);
      const content: Array<Record<string, unknown>> = [{ type: "text", text: textPrompt }];
      for (const inputImage of resolvedInputs) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${inputImage.mimeType};base64,${inputImage.base64}`,
          },
        });
      }

      const { data: result, generationId } = await createImageGeneration(apiKey, {
        model,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      });
      console.log(
        `[${toolName}] provider response op=${operation} model=${model} generationId=${generationId || "none"} elapsedMs=${Date.now() - startedAt}`,
      );

      const imagePayload = extractImageFromResponse(result);
      if (!imagePayload) {
        throw new Error("OpenRouter response did not contain an image output.");
      }

      const outputDir = resolveOutputDirectory(
        context.directory,
        args.outputDir,
        operation,
        resolvedInputs[0]?.relativePath,
      );
      const outputDirAbsolute = safeJoin(
        context.directory,
        outputDir.length > 0 ? outputDir : ".",
      );
      fs.mkdirSync(outputDirAbsolute, { recursive: true });

      const baseName =
        operation === "edit" && resolvedInputs[0]
          ? `${sanitizeForFilename(
              path.basename(
                resolvedInputs[0].relativePath,
                path.extname(resolvedInputs[0].relativePath),
              ),
            )}-ai-edited`
          : `ai-${sanitizeForFilename(prompt, 32)}`;
      const timestamp = Date.now();
      const outputAbsolutePath = ensureUniqueFilePath(
        path.join(outputDirAbsolute, `${baseName}-${timestamp}.webp`),
      );
      console.log(
        `[${toolName}] writing image to ${outputAbsolutePath} (outputDir=${outputDir || "."})`,
      );

      const generatedBuffer = await decodeGeneratedImage(imagePayload);
      await sharp(generatedBuffer).webp({ quality: WEBP_QUALITY }).toFile(outputAbsolutePath);

      const outputRelativePath = normalizeRelativePath(
        path.relative(context.directory, outputAbsolutePath),
      );
      const writtenBytes = fs.statSync(outputAbsolutePath).size;

      const projectPath = (process.env.VIVD_PROJECT_SLUG || context.directory || "").trim();
      const idempotencyKey = generationId
        ? `studio_image_gen:${generationId}`
        : `studio_image_gen:${randomUUID()}`;
      void Promise.resolve(
        usageReporter.reportImageGeneration(projectPath || undefined, idempotencyKey),
      )
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[${toolName}] usage report failed: ${message}`);
        });

      const connectedProjectSlug = (process.env.VIVD_PROJECT_SLUG || "").trim();
      const connectedProjectVersion = Number.parseInt(
        process.env.VIVD_PROJECT_VERSION || "",
        10,
      );
      if (connectedProjectSlug) {
        projectTouchReporter.touch(connectedProjectSlug);
      }
      if (
        connectedProjectSlug &&
        Number.isFinite(connectedProjectVersion) &&
        connectedProjectVersion > 0
      ) {
        requestBucketSync("image-ai-created-opencode", {
          slug: connectedProjectSlug,
          version: connectedProjectVersion,
          path: outputRelativePath,
        });
      }

      console.log(
        `[${toolName}] success op=${operation} output=${outputRelativePath} bytes=${writtenBytes} elapsedMs=${Date.now() - startedAt}`,
      );

      return JSON.stringify(
        {
          tool: toolName,
          ok: true,
          operation,
          model,
          inputImages: resolvedInputs.map((entry) => entry.relativePath),
          output: {
            path: outputRelativePath,
            fileName: path.basename(outputAbsolutePath),
          },
        },
        null,
        2,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(
        `[${toolName}] failed op=${operation} elapsedMs=${Date.now() - startedAt}: ${message}`,
      );
      if (stack) {
        console.error(stack);
      }
      return JSON.stringify(
        {
          tool: toolName,
          ok: false,
          operation,
          error: {
            code: "IMAGE_AI_FAILED",
            message,
          },
        },
        null,
        2,
      );
    }
  },
};
