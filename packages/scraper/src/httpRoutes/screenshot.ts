import { Router } from "express";
import { browserPool, isBrowserError } from "../services/browser.js";
import {
  capturePageScreenshot,
  captureReferenceScreenshot,
  type CaptureScreenshotFormat,
} from "../services/screenshot.js";
import { log } from "../utils/logger.js";

export const screenshotRouter = Router();

screenshotRouter.post("/", async (req, res) => {
  const {
    urls,
    url,
    maxScreenshots = 4,
    width,
    height,
    scrollX,
    scrollY,
    waitMs,
    headers,
    format,
    filename,
  } = req.body;
  const urlsInput =
    Array.isArray(urls) && urls.length > 0
      ? urls
      : typeof url === "string" && url.trim().length > 0
        ? [url.trim()]
        : [];

  if (urlsInput.length === 0) {
    res
      .status(400)
      .json({ error: "Missing or invalid 'url' or 'urls' input" });
    return;
  }

  const captureFormat: CaptureScreenshotFormat =
    format === "jpeg" || format === "webp" ? format : "png";
  const singleCaptureMode = typeof url === "string" && url.trim().length > 0;
  const urlsToCapture = urlsInput.slice(0, maxScreenshots);
  log(`Screenshot request for ${urlsToCapture.length} URLs`);

  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);
    const screenshots: Array<{
      url: string;
      data: string;
      filename: string;
      mimeType?: string;
    }> =
      [];

    for (let i = 0; i < urlsToCapture.length; i++) {
      const currentUrl = urlsToCapture[i];
      const result = singleCaptureMode
        ? await capturePageScreenshot(page, {
            url: currentUrl,
            width,
            height,
            scrollX,
            scrollY,
            waitMs,
            headers,
            format: captureFormat,
            filename,
            index: i,
          })
        : await captureReferenceScreenshot(page, currentUrl, i);
      if (result) {
        screenshots.push(result);
      }
    }

    await page.close();

    res.json({ screenshots });
    log(`Screenshot capture completed: ${screenshots.length} successful`);
  } catch (error: any) {
    log(`Screenshot error: ${error.message}`);
    const unhealthy = isBrowserError(error);
    if (unhealthy) {
      log(`Browser error detected, will mark browser as unhealthy`);
    }
    browserPool.release(browser, unhealthy);
    res
      .status(500)
      .json({ error: error.message || "Screenshot capture failed" });
    return;
  }
  browserPool.release(browser);
});
