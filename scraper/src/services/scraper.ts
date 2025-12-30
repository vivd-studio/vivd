import type { Page } from "puppeteer";
import * as path from "path";
import { log } from "../utils/logger.js";
import { handleCookieBanner, autoScroll, cleanText } from "../utils/cookie.js";
import {
  downloadImage,
  isBlockedDomain,
  sanitizeFilename,
  DownloadedImage,
} from "../utils/images.js";

export interface ScrapeResult {
  text: string;
  images: DownloadedImage[];
}

export async function scrapePage(
  page: Page,
  url: string,
  isMainPage: boolean = false
): Promise<ScrapeResult> {
  // Set up CDP session to intercept all image requests
  const client = await page.createCDPSession();
  await client.send("Network.enable");

  const networkImages = new Set<string>();

  // Listen for all image responses
  client.on("Network.responseReceived", (event: any) => {
    const response = event.response;
    const mimeType = response.mimeType || "";
    const resourceUrl = response.url;

    if (
      event.type === "Image" ||
      mimeType.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(resourceUrl)
    ) {
      if (
        resourceUrl.startsWith("http") &&
        !resourceUrl.includes("data:") &&
        !resourceUrl.includes("pixel") &&
        !resourceUrl.includes("tracking") &&
        !resourceUrl.includes("analytics") &&
        !resourceUrl.includes("/ddm/") &&
        !resourceUrl.includes("/fls/") &&
        !isBlockedDomain(resourceUrl)
      ) {
        networkImages.add(resourceUrl);
      }
    }
  });

  log(`Navigating to ${url}...`);
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  } catch (e) {
    log(`Error navigating to ${url}: ${e}`);
    await client.detach();
    return { text: "", images: [] };
  }

  log("Handling cookies...");
  await handleCookieBanner(page);

  log("Scrolling to trigger lazy-loaded images...");
  await autoScroll(page);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  await client.detach();

  // Get text from all frames
  let text = "";
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const frameText = await frame.evaluate(() => document.body.innerText);
      if (frameText) {
        text += frameText + "\n";
      }
    } catch {
      // Ignore cross-origin frame errors
    }
  }
  const cleanedText = cleanText(text);
  log(
    `Extracted ${text.length} characters of text from ${frames.length} frames.`
  );

  // Get DOM images with sizes
  type ImageInfo = { url: string; area: number };
  const domImages = (await page.evaluate(() => {
    return Array.from(document.images)
      .map((img) => {
        const src = img.getAttribute("src");
        let url = "";
        if (src) {
          if (src.startsWith("http") || src.startsWith("//")) {
            url = img.src;
          } else {
            try {
              url = new URL(src, window.location.href).href;
            } catch {
              url = "";
            }
          }
        }
        return {
          url,
          area:
            (img.naturalWidth || img.width || 0) *
            (img.naturalHeight || img.height || 0),
        };
      })
      .filter((item) => item.url.startsWith("http"));
  })) as ImageInfo[];

  const urlAreaMap = new Map<string, number>();
  for (const img of domImages) {
    urlAreaMap.set(img.url, img.area);
  }

  const DEFAULT_AREA = 500 * 500;
  const MIN_AREA = 40 * 40;

  const allImages = Array.from(networkImages).map((url) => ({
    url,
    area: urlAreaMap.get(url) || DEFAULT_AREA,
  }));

  allImages.sort((a, b) => b.area - a.area);

  const imageUrls = allImages
    .filter((i) => !urlAreaMap.has(i.url) || i.area >= MIN_AREA)
    .map((i) => i.url);

  log(
    `Captured ${networkImages.size} images via network, ${imageUrls.length} after filtering.`
  );

  // Download images
  const imageLimit = isMainPage ? 50 : 30;
  const downloadedImages: DownloadedImage[] = [];
  const downloadedNames = new Set<string>();

  for (const imgUrl of imageUrls.slice(0, imageLimit)) {
    const ext = path.extname(imgUrl).split("?")[0] || ".jpg";
    if (
      ![".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"].includes(
        ext.toLowerCase()
      )
    ) {
      continue;
    }

    let filename = sanitizeFilename(imgUrl, ext);

    // Handle duplicates
    let counter = 1;
    let finalFilename = filename;
    while (downloadedNames.has(finalFilename)) {
      const namePart = path.basename(filename, path.extname(filename));
      finalFilename = `${namePart}_${counter}${path.extname(filename)}`;
      counter++;
    }
    downloadedNames.add(finalFilename);

    const result = await downloadImage(imgUrl);
    if (result) {
      downloadedImages.push({
        filename: finalFilename,
        data: result.buffer.toString("base64"),
        mimeType: result.mimeType,
      });
    }
  }

  log(`Downloaded ${downloadedImages.length} images from ${url}.`);
  return { text: cleanedText, images: downloadedImages };
}
