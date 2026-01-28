import * as fs from "fs";
import sharp from "sharp";
import { scrapeWebsiteRemote, ScrapeBlockedError } from "../scraper-client";
import { analyzeImages } from "../image_analyzer";
import { createHeroImage } from "../hero_creator";
import { initializeGitRepository } from "../gitUtils";
import { log } from "../logger";
import type { GenerationContext } from "./types";
import { generateHtml } from "../steps/generateHtml";
import { thumbnailService } from "../../services/ThumbnailService";
import type { FlowContext } from "../../services/OpenRouterService";
import {
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
} from "../vivdPaths";

export interface UrlFlowInput {
  url: string;
  /** Optional hint to influence the hero image generation */
  heroHint?: string;
  /** Optional hint to influence the HTML/landing page generation */
  htmlHint?: string;
}

export async function runUrlFlow(ctx: GenerationContext, input: UrlFlowInput) {
  // Create flow context for cost tracking
  const flowContext: FlowContext = { flowId: "url", projectSlug: ctx.slug };

  ctx.updateStatus("scraping");

  try {
    await scrapeWebsiteRemote(input.url, ctx.outputDir);
  } catch (error) {
    if (error instanceof ScrapeBlockedError) {
      log(`[UrlFlow] Scrape blocked: ${error.errorType} - ${error.message}`);

      // Save the error screenshot as thumbnail so users can see what happened
      if (error.screenshot) {
        try {
          ensureVivdInternalFilesDir(ctx.outputDir);
          const thumbnailPath = getVivdInternalFilesPath(
            ctx.outputDir,
            "thumbnail.webp"
          );
          // Convert the base64 PNG screenshot to WebP thumbnail
          const screenshotBuffer = Buffer.from(error.screenshot, "base64");
          const thumbnailBuffer = await sharp(screenshotBuffer)
            .resize(640, 400, { fit: "cover", position: "top" })
            .webp({ quality: 80 })
            .toBuffer();
          fs.writeFileSync(thumbnailPath, thumbnailBuffer);
          log(`[UrlFlow] Saved error screenshot as thumbnail`);
        } catch (thumbErr) {
          log(`[UrlFlow] Failed to save error thumbnail: ${thumbErr}`);
        }
      }

      ctx.updateStatus("failed", error.message);
      return;
    }
    // Re-throw other errors
    throw error;
  }

  ctx.updateStatus("analyzing_images");
  await analyzeImages(ctx.outputDir, flowContext);

  ctx.updateStatus("creating_hero");
  await createHeroImage(ctx.outputDir, flowContext, input.heroHint);

  ctx.updateStatus("generating_html");
  try {
    await generateHtml({
      outputDir: ctx.outputDir,
      source: "url",
      flowContext,
      clientHint: input.htmlHint,
    });
  } catch (error: any) {
    log(`Error generating landing page: ${error?.message || String(error)}`);
    if (error?.response) {
      log(`Response data: ${JSON.stringify(error.response.data)}`);
    }
  }

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
