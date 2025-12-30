import type { Page } from "puppeteer";
import sharp from "sharp";
import { log } from "../utils/logger.js";

const MAX_SCREENSHOT_HEIGHT = 2000;

export async function takeMainPageScreenshot(page: Page): Promise<string> {
  log("Taking screenshot of main page...");

  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 2000));

  const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
  const height = Math.min(bodyHeight, MAX_SCREENSHOT_HEIGHT);

  const screenshot = await page.screenshot({
    fullPage: false,
    clip: { x: 0, y: 0, width: 1280, height },
    encoding: "base64",
  });

  log("Main page screenshot captured");
  return screenshot as string;
}

export async function takeHeaderScreenshot(
  mainScreenshotBase64: string
): Promise<string> {
  log("Creating header screenshot from main page screenshot...");

  try {
    const buffer = Buffer.from(mainScreenshotBase64, "base64");
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const width = metadata.width || 1280;
    const height = metadata.height || 0;
    const cropHeight = Math.min(height, 800);

    if (cropHeight <= 0) {
      throw new Error("Main screenshot has invalid height");
    }

    const headerBuffer = await image
      .extract({ left: 0, top: 0, width, height: cropHeight })
      .toBuffer();

    log("Header screenshot created");
    return headerBuffer.toString("base64");
  } catch (error) {
    log(`Error creating header screenshot: ${error}`);
    throw error;
  }
}

export async function captureReferenceScreenshot(
  page: Page,
  url: string,
  index: number
): Promise<{ url: string; data: string; filename: string } | null> {
  try {
    log(`Capturing reference screenshot: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 1500));

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const height = Math.min(bodyHeight, MAX_SCREENSHOT_HEIGHT);

    const screenshot = await page.screenshot({
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height },
      encoding: "base64",
    });

    const host = new URL(url).hostname
      .replace(/^www\./, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `ref_${index + 1}_${host}.png`;

    return {
      url,
      data: screenshot as string,
      filename,
    };
  } catch (err) {
    log(`Failed to capture reference screenshot (${url}): ${err}`);
    return null;
  }
}
