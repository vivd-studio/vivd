import { Router } from "express";
import sharp from "sharp";
import { browserPool, isBrowserError } from "../services/browser.js";
import { log } from "../utils/logger.js";
import { WEBP_QUALITY } from "../config.js";

export const thumbnailRouter = Router();

const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 800;
const DEFAULT_OUTPUT_WIDTH = 640;
const DEFAULT_OUTPUT_HEIGHT = 400;

thumbnailRouter.post("/", async (req, res) => {
  const {
    url,
    width = DEFAULT_OUTPUT_WIDTH,
    height = DEFAULT_OUTPUT_HEIGHT,
  } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' parameter" });
    return;
  }

  log(`Thumbnail request for ${url} (${width}x${height})`);

  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);

    // Set viewport to capture at higher resolution
    await page.setViewport({
      width: DEFAULT_VIEWPORT_WIDTH,
      height: DEFAULT_VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    });

    // Navigate to the URL
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait a bit for any animations/transitions to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Capture screenshot as PNG buffer
    const screenshotBuffer = await page.screenshot({
      type: "png",
      clip: {
        x: 0,
        y: 0,
        width: DEFAULT_VIEWPORT_WIDTH,
        height: DEFAULT_VIEWPORT_HEIGHT,
      },
    });

    await page.close();
    browserPool.release(browser);

    // Resize and convert to WebP using sharp
    const thumbnailBuffer = await sharp(screenshotBuffer)
      .resize(width, height, {
        fit: "cover",
        position: "top",
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    // Return as base64
    const base64Thumbnail = thumbnailBuffer.toString("base64");

    res.json({ thumbnail: base64Thumbnail });
    log(`Thumbnail generated successfully for ${url}`);
  } catch (error: any) {
    log(`Thumbnail error: ${error.message}`);
    const unhealthy = isBrowserError(error);
    if (unhealthy) {
      log(`Browser error detected, will mark browser as unhealthy`);
    }
    browserPool.release(browser, unhealthy);
    res
      .status(500)
      .json({ error: error.message || "Thumbnail capture failed" });
  }
});
