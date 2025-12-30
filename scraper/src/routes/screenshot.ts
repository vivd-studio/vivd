import { Router } from "express";
import { browserPool } from "../services/browser.js";
import { captureReferenceScreenshot } from "../services/screenshot.js";
import { log } from "../utils/logger.js";

export const screenshotRouter = Router();

screenshotRouter.post("/", async (req, res) => {
  const { urls, maxScreenshots = 4 } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "Missing or invalid 'urls' array" });
    return;
  }

  const urlsToCapture = urls.slice(0, maxScreenshots);
  log(`Screenshot request for ${urlsToCapture.length} URLs`);

  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);
    const screenshots: Array<{ url: string; data: string; filename: string }> =
      [];

    for (let i = 0; i < urlsToCapture.length; i++) {
      const url = urlsToCapture[i];
      const result = await captureReferenceScreenshot(page, url, i);
      if (result) {
        screenshots.push(result);
      }
    }

    await page.close();

    res.json({ screenshots });
    log(`Screenshot capture completed: ${screenshots.length} successful`);
  } catch (error: any) {
    log(`Screenshot error: ${error.message}`);
    res
      .status(500)
      .json({ error: error.message || "Screenshot capture failed" });
  } finally {
    browserPool.release(browser);
  }
});
