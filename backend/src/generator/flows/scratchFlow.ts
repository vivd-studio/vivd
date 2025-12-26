import * as fs from "fs";
import * as path from "path";
import { initializeGitRepository } from "../gitUtils";
import { log } from "../logger";
import type { GenerationContext } from "./types";
import { generateHtml } from "../steps/generateHtml";
import { captureReferenceScreenshots } from "../steps/captureReferenceScreenshots";
import { analyzeImages } from "../image_analyzer";

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
  input: ScratchFlowInput
) {
  ensureDir(path.join(ctx.outputDir, "images"));
  ensureDir(path.join(ctx.outputDir, "references"));

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

  fs.writeFileSync(path.join(ctx.outputDir, "scratch_brief.txt"), brief);

  if (input.referenceUrls?.length) {
    fs.writeFileSync(
      path.join(ctx.outputDir, "references", "urls.txt"),
      input.referenceUrls.join("\n") + "\n"
    );
  }

  if (input.assets?.length) {
    for (const asset of input.assets) {
      const name = sanitizeFilename(asset.filename);
      fs.writeFileSync(
        path.join(ctx.outputDir, "images", name),
        decodeBase64(asset.base64)
      );
    }
  }

  if (input.referenceImages?.length) {
    for (const asset of input.referenceImages) {
      const name = sanitizeFilename(asset.filename);
      fs.writeFileSync(
        path.join(ctx.outputDir, "references", name),
        decodeBase64(asset.base64)
      );
    }
  }

  if (input.referenceUrls?.length) {
    ctx.updateStatus("capturing_references");
    await captureReferenceScreenshots({
      outputDir: ctx.outputDir,
      referenceUrls: input.referenceUrls,
    });
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
}
