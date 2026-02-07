import type { Page } from "puppeteer";
import sharp from "sharp";
import { log } from "../utils/logger.js";

const MAX_SCREENSHOT_HEIGHT = 2000;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

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
    log(`Capturing reference screenshot: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 1500));

    const viewport = page.viewport() ?? DEFAULT_VIEWPORT;
    const width = viewport.width || DEFAULT_VIEWPORT.width;
    const viewportHeight = viewport.height || DEFAULT_VIEWPORT.height;

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
