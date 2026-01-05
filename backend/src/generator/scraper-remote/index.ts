import * as fs from "fs";
import { log } from "../logger";
import { scraperClient } from "../scraper-client";
import {
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
} from "../vivdPaths";
import {
  extractNavigationLinks,
  prioritizeNavigationLinks,
} from "../scraper/navigation";
import { deduplicateImages } from "../scraper/images";

/**
 * Scrapes a website using the remote scraper service.
 * Navigation analysis still happens locally using vision APIs.
 */
export async function scrapeWebsiteRemote(url: string, outputDir: string) {
  log(`[Remote Scraper] Target URL: ${url}`);

  // 1. Full scrape of main page (screenshots + text + images)
  const headerScreenshotPath = await scraperClient.fullScrape(url, outputDir);

  // Read main page text for deduplication
  const mainPageText = fs.readFileSync(
    getVivdInternalFilesPath(outputDir, "website_text.txt"),
    "utf-8"
  );

  // 2. Analyze Navigation with Vision Model (local - uses OpenRouter API)
  const navigationTexts = await extractNavigationLinks(headerScreenshotPath);
  log(
    `Vision model identified navigation terms: ${navigationTexts.join(", ")}`
  );

  if (navigationTexts.length === 0) {
    log(
      "[Remote Scraper] No navigation links found, skipping subpage scraping"
    );
    deduplicateImages(outputDir);
    return;
  }

  // 3. Prioritize Links (local - uses OpenRouter API)
  // For now we'll use the navigation texts as-is since findLinksMatchingTexts requires DOM access
  // This is a simplification - in a full implementation we'd need to extract links from the scraped page
  const linksForPrioritization = navigationTexts.map((text) => ({
    text,
    url: "", // We don't have URLs without DOM access
  }));

  const subpagesToScrape = await prioritizeNavigationLinks(
    linksForPrioritization
  );
  log(`Agent prioritized ${subpagesToScrape.length} subpages to scrape`);

  // Note: Since findLinksMatchingTexts requires an active browser page,
  // we skip subpage scraping for now. The main page scrape is sufficient for MVP.
  // TODO: Add a /find-links endpoint to scraper service for DOM-based link extraction

  // 4. Aggregate Text (currently just the main page)
  let aggregatedText = `## Page: Home\n\n${mainPageText}\n\n`;

  // 5. Scrape Subpages (if we had the links)
  // This would use scraperClient.scrapePage for each subpage

  // 6. Save Final Aggregated Text
  ensureVivdInternalFilesDir(outputDir);
  fs.writeFileSync(
    getVivdInternalFilesPath(outputDir, "website_text.txt"),
    aggregatedText
  );
  log(`Saved aggregated text to website_text.txt`);

  // 7. Deduplicate Images (local)
  deduplicateImages(outputDir);

  log("[Remote Scraper] Scraping completed");
}
