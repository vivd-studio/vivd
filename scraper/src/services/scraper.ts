import type { HTTPResponse, Page } from "puppeteer";
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
  const imageRequestIds = new Map<string, { requestId: string; mimeType: string }>();
  const responseImageBodies = new Map<string, { buffer: Buffer; mimeType: string }>();
  const responseImageUrls = new Set<string>();
  const MAX_PRELOADED_IMAGE_BODIES = isMainPage ? 250 : 150;
  let onResponse: ((response: HTTPResponse) => void) | null = null;
  const pendingResponseBodyTasks = new Set<Promise<void>>();

  try {
    onResponse = (response: HTTPResponse) => {
      const task = (async () => {
        try {
          const resourceUrl = response.url();
          if (!resourceUrl.startsWith("http")) return;
          if (resourceUrl.includes("data:")) return;
          if (
            resourceUrl.includes("pixel") ||
            resourceUrl.includes("tracking") ||
            resourceUrl.includes("analytics") ||
            resourceUrl.includes("/ddm/") ||
            resourceUrl.includes("/fls/") ||
            isBlockedDomain(resourceUrl)
          ) {
            return;
          }

          const contentTypeHeader = response.headers()?.["content-type"] || "";
          const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
          const isImage =
            response.request().resourceType() === "image" ||
            contentType.startsWith("image/") ||
            /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(resourceUrl);

          if (!isImage) return;

          responseImageUrls.add(resourceUrl);

          if (responseImageBodies.size >= MAX_PRELOADED_IMAGE_BODIES) return;
          if (responseImageBodies.has(resourceUrl)) return;

          const buffer = await response.buffer();
          if (!buffer || buffer.length === 0) return;

          responseImageBodies.set(resourceUrl, {
            buffer,
            mimeType: contentType || "image/jpeg",
          });
        } catch {
          // ignore
        }
      })().finally(() => {
        pendingResponseBodyTasks.delete(task);
      });

      pendingResponseBodyTasks.add(task);
    };

    page.on("response", onResponse);

    // Listen for all image responses
    client.on("Network.responseReceived", (event: any) => {
      const response = event.response;
      const mimeType = response.mimeType || "";
      const resourceUrl = response.url;
      const requestId = event.requestId;

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
          if (
            requestId &&
            typeof requestId === "string" &&
            !imageRequestIds.has(resourceUrl)
          ) {
            imageRequestIds.set(resourceUrl, { requestId, mimeType });
          }
        }
      }
    });

    log(`Navigating to ${url}...`);
    try {
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      } catch (e) {
        log(
          `Navigation attempt (networkidle2) failed for ${url}: ${e}. Retrying with domcontentloaded...`
        );
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      }
    } catch (e) {
      log(`Error navigating to ${url}: ${e}`);
      return { text: "", images: [] };
    }

    log("Handling cookies...");
    await handleCookieBanner(page);

    log("Scrolling to trigger lazy-loaded images...");
    await autoScroll(page);

    // Give frames a moment to load images; useful for lazy-loaded content and cross-origin frames.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyPage: any = page;
      if (typeof anyPage.waitForNetworkIdle === "function") {
        await anyPage.waitForNetworkIdle({ idleTime: 500, timeout: 10000 });
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, isMainPage ? 1800 : 1000));

    // Wait briefly for async response.buffer() calls to settle so we don't miss late/large images.
    const settleUntil = Date.now() + (isMainPage ? 2500 : 1500);
    while (pendingResponseBodyTasks.size > 0 && Date.now() < settleUntil) {
      await new Promise((r) => setTimeout(r, 50));
    }

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
    const domImages = (
      await Promise.all(
        frames.map(async (frame) => {
          try {
            return (await frame.evaluate(() => {
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
          } catch {
            return [] as ImageInfo[];
          }
        })
      )
    ).flat();

    const urlAreaMap = new Map<string, number>();
    for (const img of domImages) {
      const existing = urlAreaMap.get(img.url) || 0;
      urlAreaMap.set(img.url, Math.max(existing, img.area));
    }

    const DEFAULT_AREA = 500 * 500;
    const MIN_AREA = 40 * 40;

    const domUrls = new Set(domImages.map((i) => i.url));
    const responseUrls = new Set(responseImageBodies.keys());
    const allUrls = new Set<string>();
    for (const u of networkImages) allUrls.add(u);
    for (const u of domUrls) allUrls.add(u);
    for (const u of responseUrls) allUrls.add(u);
    for (const u of responseImageUrls) allUrls.add(u);

    const allImages = Array.from(allUrls).map((imageUrl) => ({
      url: imageUrl,
      area: urlAreaMap.get(imageUrl) || DEFAULT_AREA,
    }));

    allImages.sort((a, b) => b.area - a.area);

    const imageUrls = allImages
      .filter((i) => !urlAreaMap.has(i.url) || i.area >= MIN_AREA)
      .map((i) => i.url);

    log(
      `Captured ${networkImages.size} images via CDP network, ${responseImageUrls.size} via Puppeteer responses, ${domUrls.size} via DOM across frames, ${imageUrls.length} after filtering.`
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

      let preloaded: { buffer: Buffer; mimeType: string } | undefined;
      const responseBody = responseImageBodies.get(imgUrl);
      if (responseBody?.buffer?.length) {
        preloaded = responseBody;
      }

      const reqMeta = imageRequestIds.get(imgUrl);
      if (!preloaded && reqMeta?.requestId) {
        try {
          // Prefer downloading via Chromium (keeps cookies/referer; avoids hotlink protection)
          const body = (await client.send("Network.getResponseBody", {
            requestId: reqMeta.requestId,
          })) as { body: string; base64Encoded: boolean };

          const buffer = Buffer.from(
            body.body,
            body.base64Encoded ? "base64" : "utf8"
          );

          if (buffer.length > 0) {
            preloaded = {
              buffer,
              mimeType: reqMeta.mimeType || "image/jpeg",
            };
          }
        } catch {
          // Fall back to server-side fetch
        }
      }

      const result = await downloadImage(imgUrl, preloaded);
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
  } catch (e) {
    log(`Scrape error for ${url}: ${e}`);
    return { text: "", images: [] };
  } finally {
    if (onResponse) {
      try {
        page.off("response", onResponse);
      } catch {
        // ignore
      }
    }

    try {
      await client.detach();
    } catch {
      // ignore
    }
  }
}
