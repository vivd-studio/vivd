import type { Page } from "puppeteer";
import sharp from "sharp";
import { log } from "../utils/logger.js";

const MAX_SCREENSHOT_HEIGHT = 2000;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_CAPTURE_WAIT_MS = 1500;

export type CaptureScreenshotFormat = "png" | "jpeg" | "webp";

export interface ScreenshotCaptureResult {
  url: string;
  data: string;
  filename: string;
  mimeType: string;
}

export interface CaptureScreenshotOptions {
  url: string;
  width?: number;
  height?: number;
  scrollX?: number;
  scrollY?: number;
  waitMs?: number;
  headers?: Record<string, string>;
  format?: CaptureScreenshotFormat;
  filename?: string;
  index?: number;
}

async function getDocumentHeight(page: Page): Promise<number> {
  const height = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;

    const bodyHeight = Math.max(
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      body?.clientHeight ?? 0,
    );

    const htmlHeight = Math.max(
      html?.scrollHeight ?? 0,
      html?.offsetHeight ?? 0,
      html?.clientHeight ?? 0,
    );

    const viewportHeight = window.innerHeight || 0;

    return Math.max(bodyHeight, htmlHeight, viewportHeight);
  });

  if (typeof height !== "number" || !Number.isFinite(height)) return 0;
  return height;
}

function toPositiveInt(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function toNonNegativeInt(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
}

function toWaitMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CAPTURE_WAIT_MS;
  return Math.max(0, Math.min(Math.floor(value ?? DEFAULT_CAPTURE_WAIT_MS), 15_000));
}

function sanitizeFilenamePart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "capture";
}

function buildCaptureFilename(
  url: string,
  index = 0,
  format: CaptureScreenshotFormat = "png",
): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return `ref_${index + 1}_${sanitizeFilenamePart(host)}.${format}`;
}

async function applyAllowedHeaders(
  page: Page,
  headers: Record<string, string> | undefined,
): Promise<void> {
  if (!headers) return;

  const allowedHeaderKeys = new Set([
    "x-vivd-preview-token",
    "x-vivd-organization-id",
    "x-vivd-studio-token",
  ]);
  const extraHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue;
    const normalizedKey = key.toLowerCase();
    if (!allowedHeaderKeys.has(normalizedKey)) continue;
    extraHeaders[normalizedKey] = value;
  }

  if (Object.keys(extraHeaders).length > 0) {
    await page.setExtraHTTPHeaders(extraHeaders);
  }
}

async function ensureFontsSettled(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
    });
  } catch {
    // Best-effort only.
  }
}

function mimeTypeForFormat(format: CaptureScreenshotFormat): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

export async function capturePageScreenshot(
  page: Page,
  options: CaptureScreenshotOptions,
): Promise<ScreenshotCaptureResult> {
  const width = toPositiveInt(options.width ?? DEFAULT_VIEWPORT.width);
  const height = toPositiveInt(options.height ?? DEFAULT_VIEWPORT.height);
  const waitMs = toWaitMs(options.waitMs);
  const scrollX = toNonNegativeInt(options.scrollX);
  const scrollY = toNonNegativeInt(options.scrollY);
  const format = options.format ?? "png";

  log(
    `Capturing screenshot: ${options.url} (${width}x${height}, scroll=${scrollX},${scrollY}, format=${format})`,
  );

  await page.setViewport({
    width,
    height,
    deviceScaleFactor: 1,
  });
  await applyAllowedHeaders(page, options.headers);

  const response = await page.goto(options.url, {
    waitUntil: "networkidle2",
    timeout: 45000,
  });

  if (!response) {
    throw new Error("No response from preview URL");
  }

  const status = response.status();
  if (status >= 400) {
    let detail = "";
    try {
      const bodyText = await response.text();
      if (bodyText) {
        const compact = bodyText.replace(/\s+/g, " ").trim();
        if (compact) {
          detail = `: ${compact.slice(0, 240)}`;
        }
      }
    } catch {
      // Ignore response body parsing failures.
    }
    throw new Error(`Preview returned HTTP ${status}${detail}`);
  }

  const contentType = response.headers()["content-type"] || "";
  if (contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Preview returned JSON instead of HTML (${contentType})`);
  }

  await ensureFontsSettled(page);

  await page.evaluate(
    ({ nextScrollX, nextScrollY }) => {
      window.scrollTo(nextScrollX, nextScrollY);
    },
    { nextScrollX: scrollX, nextScrollY: scrollY },
  );

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const screenshot = await page.screenshot({
    type: format,
    quality: format === "png" ? undefined : 90,
    fullPage: false,
    captureBeyondViewport: false,
    encoding: "base64",
  });

  return {
    url: options.url,
    data: screenshot as string,
    filename: options.filename || buildCaptureFilename(options.url, options.index, format),
    mimeType: mimeTypeForFormat(format),
  };
}

export async function takeMainPageScreenshot(page: Page): Promise<string> {
  log("Taking screenshot of main page...");

  // Wait for fonts to be fully loaded
  try {
    await page.evaluate(() => document.fonts.ready);
    log("Fonts loaded");
  } catch (e) {
    log(`Font wait failed: ${e}`);
  }

  // Scroll down to trigger lazy-loaded images, then scroll back up
  try {
    await page.evaluate(async () => {
      const scrollStep = window.innerHeight;
      const maxScroll = Math.min(document.body.scrollHeight, 3000);

      // Scroll down in steps to trigger lazy loading
      for (let y = 0; y <= maxScroll; y += scrollStep) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }

      // Scroll back to top
      window.scrollTo(0, 0);
    });
    log("Scrolled to trigger lazy images");
  } catch (e) {
    log(`Scroll failed: ${e}`);
  }

  // Force load all lazy images by removing lazy loading attribute and triggering src
  try {
    await page.evaluate(() => {
      const images = document.querySelectorAll('img[loading="lazy"]');
      images.forEach((img) => {
        const imgEl = img as HTMLImageElement;
        imgEl.removeAttribute("loading");
        // Force reload by toggling src
        const src = imgEl.src;
        if (src) {
          imgEl.src = "";
          imgEl.src = src;
        }
      });
    });
    log("Forced lazy images to load");
  } catch (e) {
    log(`Force lazy load failed: ${e}`);
  }

  // Wait for all images to be loaded
  try {
    await page.evaluate(async () => {
      const images = Array.from(document.images);
      const imagePromises = images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          setTimeout(resolve, 3000);
        });
      });
      await Promise.race([
        Promise.all(imagePromises),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    });
    log("All images loaded");
  } catch (e) {
    log(`Image wait failed: ${e}`);
  }

  // Wait for CSS background images to load
  try {
    await page.evaluate(async () => {
      const elements = document.querySelectorAll("*");
      const bgImagePromises: Promise<void>[] = [];

      elements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;

        if (bgImage && bgImage !== "none" && bgImage.includes("url(")) {
          const urlMatches = bgImage.match(/url\(["']?([^"')]+)["']?\)/g);
          if (urlMatches) {
            urlMatches.forEach((match) => {
              const url = match
                .replace(/url\(["']?/, "")
                .replace(/["']?\)/, "");
              if (url.startsWith("http") || url.startsWith("/")) {
                const img = new Image();
                const promise = new Promise<void>((resolve) => {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                  setTimeout(resolve, 3000);
                });
                img.src = url;
                bgImagePromises.push(promise);
              }
            });
          }
        }
      });

      if (bgImagePromises.length > 0) {
        await Promise.race([
          Promise.all(bgImagePromises),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      }
    });
    log("CSS background images loaded");
  } catch (e) {
    log(`Background image wait failed: ${e}`);
  }

  // Wait for network to be truly idle
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyPage = page as any;
    if (typeof anyPage.waitForNetworkIdle === "function") {
      await anyPage.waitForNetworkIdle({ idleTime: 500, timeout: 5000 });
    }
  } catch {
    // Ignore timeout
  }

  // Final stabilization wait
  await new Promise((r) => setTimeout(r, 1000));

  const viewport = page.viewport() ?? DEFAULT_VIEWPORT;
  const width = viewport.width || DEFAULT_VIEWPORT.width;
  const viewportHeight = viewport.height || DEFAULT_VIEWPORT.height;

  // Some sites (e.g. content in iframes / scroll containers) report `document.body.scrollHeight === 0`
  // which would make Puppeteer throw: `'height' in 'clip' must be positive.`
  const documentHeight = await getDocumentHeight(page);
  const height = toPositiveInt(
    Math.min(documentHeight || viewportHeight, MAX_SCREENSHOT_HEIGHT),
  );

  const screenshot = await page.screenshot({
    fullPage: false,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height },
    encoding: "base64",
  });

  log("Main page screenshot captured");
  return screenshot as string;
}

export async function takeHeaderScreenshot(
  mainScreenshotBase64: string,
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
  index: number,
): Promise<{ url: string; data: string; filename: string } | null> {
  try {
    const result = await capturePageScreenshot(page, {
      url,
      index,
      width: DEFAULT_VIEWPORT.width,
      height: DEFAULT_VIEWPORT.height,
      waitMs: DEFAULT_CAPTURE_WAIT_MS,
      format: "png",
    });

    return {
      url: result.url,
      data: result.data,
      filename: result.filename,
    };
  } catch (err) {
    log(`Failed to capture reference screenshot (${url}): ${err}`);
    return null;
  }
}
