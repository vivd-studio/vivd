import { Router } from "express";
import { browserPool } from "../services/browser.js";
import { scrapePage } from "../services/scraper.js";
import { log } from "../utils/logger.js";

export const scrapePageRouter = Router();

/**
 * Scrape a single page (used for subpage scraping during navigation flow)
 */
scrapePageRouter.post("/", async (req, res) => {
  const { url, isMainPage = false } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' parameter" });
    return;
  }

  log(`Single page scrape request for: ${url}`);
  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);
    const result = await scrapePage(page, url, isMainPage);
    await page.close();

    res.json({
      text: result.text,
      images: result.images,
    });

    log(`Single page scrape completed for: ${url}`);
  } catch (error: any) {
    log(`Single page scrape error: ${error.message}`);
    res.status(500).json({ error: error.message || "Scrape failed" });
  } finally {
    browserPool.release(browser);
  }
});
