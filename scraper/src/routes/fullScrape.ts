import { Router } from "express";
import * as crypto from "crypto";
import { browserPool } from "../services/browser.js";
import { scrapePage } from "../services/scraper.js";
import {
  takeMainPageScreenshot,
  takeHeaderScreenshot,
} from "../services/screenshot.js";
import { log } from "../utils/logger.js";
import {
  extractNavigationTextsFromHeaderScreenshot,
  prioritizeNavigationLinks,
} from "../services/openrouter.js";
import { findLinksMatchingTexts } from "../services/links.js";
import { removeDuplicateContent } from "../utils/deduplication.js";
import sharp from "sharp";

export const fullScrapeRouter = Router();

fullScrapeRouter.post("/", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' parameter" });
    return;
  }

  log(`Full scrape request for: ${url}`);
  log("Full scrape pipeline: header vision + subpage scraping enabled");
  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);

    // Scrape the main page
    const mainPageData = await scrapePage(page, url, true);

    // Take screenshots
    const screenshot = await takeMainPageScreenshot(page);
    const headerScreenshot = await takeHeaderScreenshot(screenshot);

    const MAX_SCRAPE_SUBPAGES = parseInt(
      process.env.MAX_SCRAPE_SUBPAGES || "6",
      10
    );
    const MAX_LINKS_TO_CONSIDER = parseInt(
      process.env.MAX_LINKS_TO_CONSIDER || "80",
      10
    );
    const MAX_TOTAL_IMAGES = parseInt(
      process.env.MAX_TOTAL_IMAGES || "150",
      10
    );

    const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY);
    if (!hasOpenRouterKey) {
      log(
        "OPENROUTER_API_KEY is not set in scraper; skipping header vision and subpage scraping."
      );
    }

    // Extract navigation texts from header screenshot (vision model)
    const navigationTexts = hasOpenRouterKey
      ? await extractNavigationTextsFromHeaderScreenshot(headerScreenshot)
      : [];
    log(
      `Vision model identified navigation terms (${navigationTexts.length}): ${navigationTexts.join(
        ", "
      )}`
    );

    let aggregatedText = `## Page: Home\n\n${mainPageData.text}\n\n`;
    const allImages = [...mainPageData.images];

    if (navigationTexts.length > 0) {
      // Resolve navigation terms to actual URLs in the DOM (including frames)
      const foundLinks = await findLinksMatchingTexts(
        page,
        navigationTexts,
        MAX_LINKS_TO_CONSIDER
      );
      log(`Matched ${foundLinks.length} candidate navigation links in DOM`);

      const prioritizedUrls = await prioritizeNavigationLinks(
        foundLinks,
        MAX_SCRAPE_SUBPAGES
      );
      log(
        `Prioritized ${prioritizedUrls.length} subpages for scraping (max=${MAX_SCRAPE_SUBPAGES})`
      );

      const uniqueSubpages = Array.from(
        new Set(
          prioritizedUrls
            .filter(Boolean)
            .map((u) => u.split("#")[0])
            .filter(Boolean)
            .filter((u) => u !== url)
        )
      );

      for (const subUrl of uniqueSubpages) {
        log(`Scraping subpage: ${subUrl}`);
        const subpageData = await scrapePage(page, subUrl, false);
        if (subpageData.text?.trim()) {
          const cleaned = removeDuplicateContent(aggregatedText, subpageData.text, 3);
          aggregatedText += `## Page: ${subUrl}\n\n${cleaned}\n\n`;
        }
        allImages.push(...subpageData.images);
        if (allImages.length >= MAX_TOTAL_IMAGES * 2) break;
      }
      log(
        `Subpage scraping finished (${uniqueSubpages.length} attempted); aggregated text length=${aggregatedText.length}`
      );
    }

    // De-duplicate and filter images (by content hash + minimum pixel area)
    const uniqueImages: typeof allImages = [];
    const seenHashes = new Set<string>();
    const usedNames = new Set<string>();

    for (const img of allImages) {
      try {
        const buffer = Buffer.from(img.data, "base64");
        const hash = crypto.createHash("sha1").update(buffer).digest("hex");
        if (seenHashes.has(hash)) continue;

        // Filter very small raster images (icons/pixels) even if URL looked "big"
        if (!img.mimeType.includes("svg")) {
          try {
            const meta = await sharp(buffer).metadata();
            const w = meta.width || 0;
            const h = meta.height || 0;
            if (w > 0 && h > 0 && w * h < 40 * 40) continue;
          } catch {
            // ignore
          }
        }

        seenHashes.add(hash);

        let filename = img.filename || `${hash}.img`;
        if (usedNames.has(filename)) {
          const ext = filename.includes(".")
            ? `.${filename.split(".").pop()}`
            : "";
          filename = `${hash}${ext || ".img"}`;
        }
        usedNames.add(filename);

        uniqueImages.push({ ...img, filename });
        if (uniqueImages.length >= MAX_TOTAL_IMAGES) break;
      } catch {
        // ignore bad image
      }
    }

    await page.close();

    res.json({
      websiteText: aggregatedText,
      screenshot,
      headerScreenshot,
      images: uniqueImages,
    });

    log(`Full scrape completed for: ${url}`);
  } catch (error: any) {
    log(`Full scrape error: ${error.message}`);
    res.status(500).json({ error: error.message || "Scrape failed" });
  } finally {
    browserPool.release(browser);
  }
});
