import { scrapeWebsite } from "../scraper";
import { analyzeImages } from "../image_analyzer";
import { createHeroImage } from "../hero_creator";
import { initializeGitRepository } from "../gitUtils";
import { log } from "../logger";
import type { GenerationContext } from "./types";
import { generateHtml } from "../steps/generateHtml";

export interface UrlFlowInput {
  url: string;
}

export async function runUrlFlow(ctx: GenerationContext, input: UrlFlowInput) {
  ctx.updateStatus("scraping");
  await scrapeWebsite(input.url, ctx.outputDir);

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
}
