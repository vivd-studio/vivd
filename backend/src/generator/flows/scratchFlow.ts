import * as fs from "fs";
import * as path from "path";
import { initializeGitRepository } from "../gitUtils";
import { log } from "../logger";
import type { GenerationContext } from "./types";
import { generateHtml } from "../steps/generateHtml";
import { scraperClient } from "../scraper-client";
import { analyzeImages } from "../image_analyzer";
import { thumbnailService } from "../../services/ThumbnailService";

export interface ScratchAssetInput {
  filename: string;
  base64: string;
}

export interface ScratchFlowInput {
  title: string;
  description: string;
  businessType?: string;
  stylePreset?: string;
  stylePalette?: string[];
  styleMode?: "exact" | "reference";
  siteTheme?: "dark" | "light";
  referenceUrls?: string[];
  assets?: ScratchAssetInput[];
  referenceImages?: ScratchAssetInput[];
}

function decodeBase64(data: string): Buffer {
  const cleaned = data.replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(cleaned, "base64");
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export async function runScratchFlow(
  ctx: GenerationContext,
  input: ScratchFlowInput,
) {
  const imagesDir = path.join(ctx.outputDir, "images");
  const referencesDir = path.join(ctx.outputDir, "references");
  ensureDir(imagesDir);
  ensureDir(referencesDir);

  // Only write brief if it doesn't already exist (for 3-step flow, it's written in createScratchDraft)
  const briefPath = path.join(ctx.outputDir, "scratch_brief.txt");
  if (!fs.existsSync(briefPath)) {
    const brief = [
      `Title: ${input.title}`,
      input.businessType ? `Business type: ${input.businessType}` : null,
      "",
      "Description:",
      input.description,
      input.stylePreset ? "" : null,
      input.stylePreset ? `Style preset: ${input.stylePreset}` : null,
      input.stylePreset && input.styleMode
        ? `Style mode: ${input.styleMode}`
        : null,
      input.stylePreset && input.stylePalette?.length
        ? `Style palette: ${input.stylePalette.join(", ")}`
        : null,
      input.siteTheme ? `Site theme: ${input.siteTheme}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    fs.writeFileSync(briefPath, brief);
  }

  // Only write reference URLs if urls.txt doesn't exist and we have URLs
  const urlsPath = path.join(ctx.outputDir, "references", "urls.txt");
  if (input.referenceUrls?.length && !fs.existsSync(urlsPath)) {
    fs.writeFileSync(urlsPath, input.referenceUrls.join("\n") + "\n");
  }

  // Write base64 assets only if provided (for legacy flow)
  // In 3-step flow, assets are already uploaded via multipart
  if (input.assets?.length) {
    for (const asset of input.assets) {
      const name = sanitizeFilename(asset.filename);
      fs.writeFileSync(
        path.join(ctx.outputDir, "images", name),
        decodeBase64(asset.base64),
      );
    }
  }

  if (input.referenceImages?.length) {
    for (const asset of input.referenceImages) {
      const name = sanitizeFilename(asset.filename);
      fs.writeFileSync(
        path.join(ctx.outputDir, "references", name),
        decodeBase64(asset.base64),
      );
    }
  }

  if (input.referenceUrls?.length) {
    ctx.updateStatus("capturing_references");
    await scraperClient.captureScreenshots(
      input.referenceUrls,
      ctx.outputDir,
      4,
    );
  }

  ctx.updateStatus("analyzing_images");
  await analyzeImages(ctx.outputDir);

  ctx.updateStatus("generating_html");
  await generateHtml({
    outputDir: ctx.outputDir,
    source: "scratch",
    scratch: {
      title: input.title,
      businessType: input.businessType,
      stylePreset: input.stylePreset,
      stylePalette: input.stylePalette,
      styleMode: input.styleMode,
      siteTheme: input.siteTheme,
    },
  });

  ctx.updateStatus("completed");

  try {
    await initializeGitRepository(ctx.outputDir, "Initial generation");
    log(`[Git] Initialized repository and committed in ${ctx.outputDir}`);
  } catch (gitError) {
    log(`[Git] Warning: Failed to initialize/commit git: ${gitError}`);
  }

  // Generate thumbnail (fire-and-forget)
  thumbnailService
    .generateThumbnailImmediate(ctx.outputDir, ctx.slug, ctx.version)
    .catch((err) => log(`[Thumbnail] Warning: ${err.message}`));
}
