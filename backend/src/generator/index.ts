import { scrapeWebsite } from "./scraper/index";
import { generateLandingPage } from "./generator";
import { analyzeImages } from "./image_analyzer/index";
import { createHeroImage } from "./hero_creator";
import { log } from "./logger";
import { validateConfig } from "./config";
import {
  getProjectDir,
  getVersionDir,
  createVersionEntry,
  updateVersionStatus,
  getNextVersion,
} from "./versionUtils";
import { initializeGitRepository } from "./gitUtils";

export {
  scrapeWebsite,
  generateLandingPage,
  analyzeImages,
  createHeroImage,
  log,
  validateConfig,
};
import * as fs from "fs";

/**
 * Process a URL to generate a landing page
 * @param targetUrl - The URL to scrape and generate from
 * @param version - Optional version number. If not provided, creates next version.
 */
export async function processUrl(targetUrl: string, version?: number) {
  validateConfig();

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = "https://" + targetUrl;
  }

  const domainSlug = new URL(targetUrl).hostname
    .replace("www.", "")
    .split(".")[0];

  // Determine version to use
  const targetVersion = version ?? getNextVersion(domainSlug);

  // Get version-specific output directory
  const projectDir = getProjectDir(domainSlug);
  const outputDir = getVersionDir(domainSlug, targetVersion);

  // Ensure directories exist
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create version entry in manifest
  createVersionEntry(domainSlug, targetVersion, targetUrl, "pending");

  // Save version-specific project metadata
  const projectJsonPath = `${outputDir}/project.json`;
  const projectData = {
    url: targetUrl,
    createdAt: new Date().toISOString(),
    status: "pending",
    version: targetVersion,
  };
  fs.writeFileSync(projectJsonPath, JSON.stringify(projectData, null, 2));

  const updateStatus = (status: string) => {
    // Update version-specific project.json
    const currentData = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
    currentData.status = status;
    fs.writeFileSync(projectJsonPath, JSON.stringify(currentData, null, 2));

    // Also update manifest
    updateVersionStatus(domainSlug, targetVersion, status);
  };

  try {
    updateStatus("scraping");
    await scrapeWebsite(targetUrl, outputDir);

    updateStatus("analyzing_images");
    await analyzeImages(outputDir);

    updateStatus("creating_hero");
    await createHeroImage(outputDir);

    updateStatus("generating_html");
    await generateLandingPage(outputDir);

    updateStatus("completed");
    // Initialize git and commit files (required for OpenCode undo/revert to work)
    try {
      await initializeGitRepository(outputDir, "Initial generation");
      log(`[Git] Initialized repository and committed in ${outputDir}`);
    } catch (gitError) {
      log(`[Git] Warning: Failed to initialize/commit git: ${gitError}`);
    }

    return { success: true, outputDir, domainSlug, version: targetVersion };
  } catch (error) {
    log(`An error occurred: ${error}`);
    try {
      updateStatus("failed");
    } catch (writeError) {
      console.error(
        "Failed to write failure status to project.json:",
        writeError
      );
    }
    throw error;
  }
}
