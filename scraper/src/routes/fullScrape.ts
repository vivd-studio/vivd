import { Router } from "express";
import { browserPool } from "../services/browser.js";
import { scrapePage } from "../services/scraper.js";
import {
  takeMainPageScreenshot,
  takeHeaderScreenshot,
} from "../services/screenshot.js";
import { log } from "../utils/logger.js";

export const fullScrapeRouter = Router();

fullScrapeRouter.post("/", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' parameter" });
    return;
  }

  log(`Full scrape request for: ${url}`);
  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);

    // Scrape the main page
    const mainPageData = await scrapePage(page, url, true);

    // Take screenshots
    const screenshot = await takeMainPageScreenshot(page);
    const headerScreenshot = await takeHeaderScreenshot(screenshot);

    await page.close();

    res.json({
      websiteText: mainPageData.text,
      screenshot,
      headerScreenshot,
      images: mainPageData.images,
    });

    log(`Full scrape completed for: ${url}`);
  } catch (error: any) {
    log(`Full scrape error: ${error.message}`);
    res.status(500).json({ error: error.message || "Scrape failed" });
  } finally {
    browserPool.release(browser);
  }
});
