import { scrapeWebsiteRemote } from "../scraper-remote";
import { analyzeImages } from "../image_analyzer";
import { createHeroImage } from "../hero_creator";
import { initializeGitRepository } from "../gitUtils";
import { log } from "../logger";
import type { GenerationContext } from "./types";
import { generateHtml } from "../steps/generateHtml";
import { ScrapeBlockedError } from "../scraper-client";
import { thumbnailService } from "../../services/ThumbnailService";

export interface UrlFlowInput {
  url: string;
}

export async function runUrlFlow(ctx: GenerationContext, input: UrlFlowInput) {
  ctx.updateStatus("scraping");

  try {
    await scrapeWebsiteRemote(input.url, ctx.outputDir);
  } catch (error) {
    if (error instanceof ScrapeBlockedError) {
      log(`[UrlFlow] Scrape blocked: ${error.errorType} - ${error.message}`);
      ctx.updateStatus("failed", error.message);
      return;
    }
    // Re-throw other errors
    throw error;
  }

  ctx.updateStatus("analyzing_images");
  await analyzeImages(ctx.outputDir);

  ctx.updateStatus("creating_hero");
  await createHeroImage(ctx.outputDir);

  ctx.updateStatus("generating_html");
  try {
    await generateHtml({ outputDir: ctx.outputDir, source: "url" });
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
