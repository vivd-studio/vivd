import * as fs from "fs";
import { log } from "../logger";
import { scraperClient } from "../scraper-client";
import {
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
} from "../vivdPaths";

/**
 * Scrapes a website using the remote scraper service.
 * The scraper service returns already aggregated text + images.
 */
export async function scrapeWebsiteRemote(url: string, outputDir: string) {
  log(`[Remote Scraper] Target URL: ${url}`);

  await scraperClient.fullScrape(url, outputDir);

  ensureVivdInternalFilesDir(outputDir);
  const websiteTextPath = getVivdInternalFilesPath(outputDir, "website_text.txt");
  if (fs.existsSync(websiteTextPath)) {
    const text = fs.readFileSync(websiteTextPath, "utf-8");
    log(`[Remote Scraper] Saved website_text.txt (${text.length} chars)`);
  }

  log("[Remote Scraper] Scraping completed");
}
