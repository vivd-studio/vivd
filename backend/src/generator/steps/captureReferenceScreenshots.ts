import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";
import { MAX_SCREENSHOT_HEIGHT } from "../config";
import { log } from "../logger";

puppeteer.use(StealthPlugin());

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function captureReferenceScreenshots(input: {
  outputDir: string;
  referenceUrls: string[];
  maxScreenshots?: number;
}): Promise<string[]> {
  const referencesDir = path.join(input.outputDir, "references");
  if (!fs.existsSync(referencesDir)) fs.mkdirSync(referencesDir, { recursive: true });

  const urls = input.referenceUrls
    .map(normalizeUrl)
    .filter(Boolean)
    .slice(0, input.maxScreenshots ?? 4);

  if (!urls.length) return [];

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const savedPaths: string[] = [];

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        log(`[Scratch] Capturing reference screenshot: ${url}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });

        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise((r) => setTimeout(r, 1500));

        const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
        const height = Math.min(bodyHeight, MAX_SCREENSHOT_HEIGHT);

        const host = safeName(new URL(url).hostname.replace(/^www\./, ""));
        const outPath = path.join(referencesDir, `ref_${i + 1}_${host}.png`);

        await page.screenshot({
          path: outPath,
          fullPage: false,
          clip: { x: 0, y: 0, width: 1280, height },
        });

        savedPaths.push(outPath);
      } catch (err) {
        log(`[Scratch] Failed to capture reference screenshot (${url}): ${err}`);
      }
    }
  } finally {
    await browser.close();
  }

  return savedPaths;
}

