import { Router } from "express";
import { browserPool, isBrowserError } from "../services/browser.js";
import { log } from "../utils/logger.js";
import { handleCookieBanner } from "../utils/cookie.js";

export const findLinksRouter = Router();

type FoundLink = { text: string; url: string };

function isValidHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

findLinksRouter.post("/", async (req, res) => {
  const { url, texts, maxLinks = 50 } = req.body as {
    url?: string;
    texts?: unknown;
    maxLinks?: unknown;
  };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' parameter" });
    return;
  }

  if (!Array.isArray(texts) || !texts.every((t) => typeof t === "string")) {
    res.status(400).json({ error: "Missing or invalid 'texts' parameter" });
    return;
  }

  const max =
    typeof maxLinks === "number" && Number.isFinite(maxLinks)
      ? Math.max(1, Math.min(200, Math.floor(maxLinks)))
      : 50;

  log(`Find-links request for: ${url} (${texts.length} terms)`);
  const browser = await browserPool.acquire();

  try {
    const page = await browserPool.createPage(browser);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (e) {
      log(`Find-links navigation failed (networkidle2) for ${url}: ${e}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    }

    await handleCookieBanner(page);
    await new Promise((r) => setTimeout(r, 500));

    const lowerTexts = texts.map((t) => t.trim().toLowerCase()).filter(Boolean);

    const links = (await Promise.all(
      page.frames().map(async (frame) => {
        try {
          return (await frame.evaluate((terms: string[]) => {
            const normalize = (s: string) =>
              s.toLowerCase().replace(/\s+/g, " ").trim();

            const isUsefulHref = (href: string) =>
              href &&
              !href.startsWith("javascript:") &&
              !href.startsWith("mailto:") &&
              !href.startsWith("tel:") &&
              !href.startsWith("#");

            const found = new Map<string, { text: string; url: string }>();
            const anchors = Array.from(document.querySelectorAll("a"));

            for (const a of anchors) {
              const hrefAttr = a.getAttribute("href") || "";
              if (!isUsefulHref(hrefAttr)) continue;

              const text = normalize(a.innerText || "");
              const id = normalize(a.id || "");

              let imgAlt = "";
              const img = a.querySelector("img");
              if (img) {
                imgAlt = normalize(img.getAttribute("alt") || "");
              }

              const matches = (candidate: string) =>
                candidate && terms.some((t) => candidate.includes(t));

              const match =
                matches(text) || matches(id) || (imgAlt && matches(imgAlt));
              if (!match) continue;

              let resolvedUrl = a.href || "";
              if (
                hrefAttr &&
                !hrefAttr.startsWith("http") &&
                !hrefAttr.startsWith("//")
              ) {
                try {
                  resolvedUrl = new URL(hrefAttr, window.location.href).href;
                } catch {
                  // ignore
                }
              }

              if (!resolvedUrl.startsWith("http")) continue;

              const label = text || imgAlt || id || hrefAttr;
              if (!found.has(resolvedUrl)) {
                found.set(resolvedUrl, { text: label, url: resolvedUrl });
              }
            }

            return Array.from(found.values());
          }, lowerTexts)) as FoundLink[];
        } catch {
          return [] as FoundLink[];
        }
      })
    )) as FoundLink[][];

    const merged = new Map<string, FoundLink>();
    for (const group of links) {
      for (const link of group) {
        if (!link?.url || !isValidHttpUrl(link.url)) continue;
        if (!merged.has(link.url)) merged.set(link.url, link);
      }
    }

    const result = Array.from(merged.values()).slice(0, max);
    await page.close();

    res.json({ links: result });
    log(`Find-links completed for: ${url} (${result.length} links)`);
  } catch (error: any) {
    log(`Find-links error: ${error.message}`);
    const unhealthy = isBrowserError(error);
    if (unhealthy) {
      log(`Browser error detected, will mark browser as unhealthy`);
    }
    browserPool.release(browser, unhealthy);
    res.status(500).json({ error: error.message || "Find-links failed" });
    return;
  }
  browserPool.release(browser);
});

