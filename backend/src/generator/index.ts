import { generateLandingPage } from "./generator";
import { analyzeImages } from "./image_analyzer/index";
import { createHeroImage } from "./hero_creator";
import { log } from "./logger";
import { validateConfig } from "./config";
import { getNextVersion } from "./versionUtils";
import { createGenerationContext } from "./core/context";
import { runUrlFlow } from "./flows/urlFlow";
import { runScratchFlow } from "./flows/scratchFlow";

export {
  generateLandingPage,
  analyzeImages,
  createHeroImage,
  log,
  validateConfig,
};
import type { ScratchFlowInput } from "./flows/scratchFlow";

export interface ProcessUrlOptions {
  /** Optional hint to influence the hero image generation */
  heroHint?: string;
  /** Optional hint to influence the HTML/landing page generation */
  htmlHint?: string;
}

/**
 * Process a URL to generate a landing page
 * @param targetUrl - The URL to scrape and generate from
 * @param version - Optional version number. If not provided, creates next version.
 * @param options - Optional hints to influence generation
 */
export async function processUrl(
  targetUrl: string,
  version?: number,
  options?: ProcessUrlOptions
) {
  validateConfig();

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = "https://" + targetUrl;
  }

  const domainSlug = new URL(targetUrl).hostname
    .replace("www.", "")
    .split(".")[0];
  const targetVersion = version ?? getNextVersion(domainSlug);
  const ctx = createGenerationContext({
    source: "url",
    url: targetUrl,
    slug: domainSlug,
    version: targetVersion,
    initialStatus: "pending",
  });

  try {
    await runUrlFlow(ctx, {
      url: targetUrl,
      heroHint: options?.heroHint,
      htmlHint: options?.htmlHint,
    });
    return {
      success: true,
      outputDir: ctx.outputDir,
      domainSlug,
      version: targetVersion,
    };
  } catch (error) {
    log(`An error occurred: ${error}`);
    try {
      ctx.updateStatus("failed");
    } catch (writeError) {
      console.error(
        "Failed to write failure status to project.json:",
        writeError
      );
    }
    throw error;
  }
}

export async function processScratchProject(
  input: ScratchFlowInput & { slug?: string; version?: number }
) {
  validateConfig();

  const ctx = createGenerationContext({
    source: "scratch",
    title: input.title,
    description: input.description,
    slug: input.slug,
    version: input.version,
    allowSlugSuffix: !input.slug,
    initialStatus: "pending",
  });

  try {
    await runScratchFlow(ctx, input);
    return {
      success: true,
      outputDir: ctx.outputDir,
      slug: ctx.slug,
      version: ctx.version,
    };
  } catch (error) {
    log(`An error occurred: ${error}`);
    try {
      ctx.updateStatus("failed");
    } catch {
      // ignore
    }
    throw error;
  }
}
