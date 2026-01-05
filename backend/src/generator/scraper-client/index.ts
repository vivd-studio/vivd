import * as fs from "fs";
import * as path from "path";
import { log } from "../logger";
import { ensureVivdInternalFilesDir, getVivdInternalFilesPath } from "../vivdPaths";

const SCRAPER_URL = process.env.SCRAPER_URL || "http://scraper:3001";
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

interface FullScrapeResponse {
  websiteText: string;
  screenshot: string;
  headerScreenshot: string;
  images: Array<{
    filename: string;
    data: string;
    mimeType: string;
  }>;
}

interface ScreenshotResponse {
  screenshots: Array<{
    url: string;
    data: string;
    filename: string;
  }>;
}

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      };

      if (SCRAPER_API_KEY) {
        headers["X-API-Key"] = SCRAPER_API_KEY;
      }

      const res = await fetch(url, {
        ...options,
        headers,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      return res.json() as T;
    } catch (e) {
      const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      log(
        `[ScraperClient] Attempt ${i + 1} failed: ${e}. ${
          i < retries - 1 ? `Retrying in ${delay}ms...` : "Giving up."
        }`
      );
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const scraperClient = {
  /**
   * Performs a full scrape of the given URL and saves results to outputDir
   * Returns the header screenshot path for navigation analysis
   */
  async fullScrape(url: string, outputDir: string): Promise<string> {
    log(`[ScraperClient] Requesting full scrape: ${url}`);

    const response = await fetchWithRetry<FullScrapeResponse>(
      `${SCRAPER_URL}/full-scrape`,
      {
        method: "POST",
        body: JSON.stringify({ url }),
      }
    );

    ensureVivdInternalFilesDir(outputDir);

    // Save website text
    fs.writeFileSync(
      getVivdInternalFilesPath(outputDir, "website_text.txt"),
      response.websiteText
    );
    log(`[ScraperClient] Saved website_text.txt`);

    // Save main screenshot
    const screenshotBuffer = Buffer.from(response.screenshot, "base64");
    fs.writeFileSync(
      getVivdInternalFilesPath(outputDir, "screenshot.png"),
      screenshotBuffer
    );
    log(`[ScraperClient] Saved screenshot.png`);

    // Save header screenshot
    const headerPath = getVivdInternalFilesPath(outputDir, "header_screenshot.png");
    const headerBuffer = Buffer.from(response.headerScreenshot, "base64");
    fs.writeFileSync(headerPath, headerBuffer);
    log(`[ScraperClient] Saved header_screenshot.png`);

    // Save images
    const imagesDir = path.join(outputDir, "images");
    ensureDir(imagesDir);

    for (const img of response.images) {
      const imgBuffer = Buffer.from(img.data, "base64");
      fs.writeFileSync(path.join(imagesDir, img.filename), imgBuffer);
    }
    log(`[ScraperClient] Saved ${response.images.length} images`);

    return headerPath;
  },

  /**
   * Captures screenshots of reference URLs and saves them to outputDir/references
   */
  async captureScreenshots(
    urls: string[],
    outputDir: string,
    maxScreenshots = 4
  ): Promise<string[]> {
    log(`[ScraperClient] Requesting screenshots for ${urls.length} URLs`);

    const response = await fetchWithRetry<ScreenshotResponse>(
      `${SCRAPER_URL}/screenshot`,
      {
        method: "POST",
        body: JSON.stringify({ urls, maxScreenshots }),
      }
    );

    const referencesDir = path.join(outputDir, "references");
    ensureDir(referencesDir);

    const savedPaths: string[] = [];

    for (const screenshot of response.screenshots) {
      const screenshotBuffer = Buffer.from(screenshot.data, "base64");
      const screenshotPath = path.join(referencesDir, screenshot.filename);
      fs.writeFileSync(screenshotPath, screenshotBuffer);
      savedPaths.push(screenshotPath);
    }

    log(`[ScraperClient] Saved ${savedPaths.length} reference screenshots`);
    return savedPaths;
  },

  /**
   * Scrapes a single page and returns text + images (used for subpage scraping)
   */
  async scrapePage(
    url: string,
    outputDir: string,
    isMainPage = false
  ): Promise<{ text: string; images: string[] }> {
    log(`[ScraperClient] Requesting single page scrape: ${url}`);

    interface ScrapePageResponse {
      text: string;
      images: Array<{ filename: string; data: string; mimeType: string }>;
    }

    const response = await fetchWithRetry<ScrapePageResponse>(
      `${SCRAPER_URL}/scrape-page`,
      {
        method: "POST",
        body: JSON.stringify({ url, isMainPage }),
      }
    );

    // Save images
    const imagesDir = path.join(outputDir, "images");
    ensureDir(imagesDir);

    const savedImages: string[] = [];
    for (const img of response.images) {
      const imgBuffer = Buffer.from(img.data, "base64");
      fs.writeFileSync(path.join(imagesDir, img.filename), imgBuffer);
      savedImages.push(img.filename);
    }

    log(`[ScraperClient] Scraped page with ${savedImages.length} images`);
    return { text: response.text, images: savedImages };
  },
};
