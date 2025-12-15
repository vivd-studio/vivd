import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { log } from "../logger";
import { autoScroll, downloadImage, cleanText } from "../utils";
import { handleCookieBanner } from "./cookie";

// Domains that serve tracking pixels, ads, or analytics - not real content images
const BLOCKED_DOMAINS = [
  "adservice.google.com",
  "googleads.g.doubleclick.net",
  "www.googleadservices.com",
  "pagead2.googlesyndication.com",
  "ad.doubleclick.net",
  "cm.g.doubleclick.net",
  "stats.g.doubleclick.net",
  "facebook.com/tr",
  "connect.facebook.net",
  "analytics.",
  "pixel.",
  "tracking.",
  "beacon.",
  ".cdn.ampproject.org",
];

export async function scrapePage(
  page: any,
  url: string,
  outputDir: string,
  isMainPage: boolean = false
): Promise<{ text: string; images: string[] }> {
  // Set up CDP session to intercept all image requests
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");

  const networkImages = new Set<string>();

  // Listen for all image responses
  client.on("Network.responseReceived", (event: any) => {
    const response = event.response;
    const mimeType = response.mimeType || "";
    const resourceUrl = response.url;

    // Capture images based on MIME type or resource type
    if (
      event.type === "Image" ||
      mimeType.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(resourceUrl)
    ) {
      // Filter out data URIs, tracking pixels, ads, and tiny icons
      const isBlockedDomain = BLOCKED_DOMAINS.some((domain) =>
        resourceUrl.includes(domain)
      );
      if (
        resourceUrl.startsWith("http") &&
        !resourceUrl.includes("data:") &&
        !resourceUrl.includes("pixel") &&
        !resourceUrl.includes("tracking") &&
        !resourceUrl.includes("analytics") &&
        !resourceUrl.includes("/ddm/") && // DoubleClick tracking
        !resourceUrl.includes("/fls/") && // Floodlight tags
        !isBlockedDomain
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

  // Wait a bit for any final lazy-loaded images
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Detach CDP session
  await client.detach();

  // Get Text from all frames
  let text = "";
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const frameText = await frame.evaluate(() => document.body.innerText);
      if (frameText) {
        text += frameText + "\n";
      }
    } catch (e) {
      // Ignore cross-origin frame errors or empty frames
    }
  }
  const cleanedText = cleanText(text);
  log(
    `Extracted ${text.length} characters of text from ${frames.length} frames.`
  );

  // Also get DOM images with their sizes for prioritization
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
            } catch (e) {
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

  // Create a map of URL -> area from DOM images
  const urlAreaMap = new Map<string, number>();
  for (const img of domImages) {
    urlAreaMap.set(img.url, img.area);
  }

  // Combine network images with area info (default to large area for non-DOM images like backgrounds)
  const DEFAULT_AREA = 500 * 500; // Assume background images are reasonably sized
  const MIN_AREA = 40 * 40;

  const allImages = Array.from(networkImages).map((url) => ({
    url,
    area: urlAreaMap.get(url) || DEFAULT_AREA,
  }));

  // Sort by area descending (largest first)
  allImages.sort((a, b) => b.area - a.area);

  // Filter out tiny images (only apply to DOM images where we know the size)
  const imageUrls = allImages
    .filter((i) => !urlAreaMap.has(i.url) || i.area >= MIN_AREA)
    .map((i) => i.url);

  log(
    `Captured ${networkImages.size} images via network interception, ${imageUrls.length} after filtering.`
  );

  log(`Found ${imageUrls.length} images (after filtering tiny ones).`);

  // Download Images
  const imagesDir = path.join(outputDir, "images");
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  let imgCount = 0;
  const downloadedNames = new Set<string>();
  const savedImages: string[] = [];

  // Limit images per page (increased to capture more)
  const imageLimit = isMainPage ? 50 : 30;

  for (const url of imageUrls.slice(0, imageLimit)) {
    const ext = path.extname(url).split("?")[0] || ".jpg";
    if (![".jpg", ".jpeg", ".png", ".webp", ".svg"].includes(ext.toLowerCase()))
      continue;

    // Extract filename from URL
    let filename = path.basename(new URL(url).pathname);
    try {
      filename = decodeURIComponent(filename);
    } catch (e) {
      // ignore
    }

    // Sanitize filename
    filename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    // Limit filename length to avoid filesystem errors (max 255 bytes, leave room for extension and counter)
    const MAX_BASENAME_LENGTH = 180;
    if (filename.length > MAX_BASENAME_LENGTH) {
      // Create a short hash from the original URL for uniqueness
      const hash = crypto
        .createHash("md5")
        .update(url)
        .digest("hex")
        .slice(0, 8);
      // Truncate and append hash
      const truncatedPart = filename.slice(0, MAX_BASENAME_LENGTH - 9); // 9 = underscore + 8 char hash
      filename = `${truncatedPart}_${hash}`;
    }

    // Convert extension to webp for raster images
    let finalExt = ext;
    if ([".jpg", ".jpeg", ".png"].includes(ext.toLowerCase())) {
      finalExt = ".webp";
    }

    // Ensure extension matches
    if (!filename.toLowerCase().endsWith(finalExt.toLowerCase())) {
      // Remove old extension if present
      if (filename.toLowerCase().endsWith(ext.toLowerCase())) {
        filename = filename.substring(0, filename.length - ext.length);
      }
      filename += finalExt;
    }

    // Handle duplicates
    let finalFilename = filename;
    let counter = 1;
    while (
      downloadedNames.has(finalFilename) ||
      fs.existsSync(path.join(imagesDir, finalFilename))
    ) {
      const namePart = path.basename(filename, finalExt);
      finalFilename = `${namePart}_${counter}${finalExt}`;
      counter++;
    }
    downloadedNames.add(finalFilename);

    const filepath = path.join(imagesDir, finalFilename);
    try {
      await downloadImage(url, filepath);
      savedImages.push(finalFilename);
      imgCount++;
    } catch (e) {
      log(`Failed to download image ${url}: ${e}`);
    }
  }
  log(`Downloaded ${imgCount} images from ${url}.`);

  return { text: cleanedText, images: savedImages };
}
