import type { Page } from "puppeteer";

export interface FoundLink {
  text: string;
  url: string;
}

export async function findLinksMatchingTexts(
  page: Page,
  texts: string[],
  maxLinks: number
): Promise<FoundLink[]> {
  const terms = texts.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (terms.length === 0) return [];

  const results = await Promise.all(
    page.frames().map(async (frame) => {
      try {
        return (await frame.evaluate((searchTerms: string[]) => {
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
              candidate && searchTerms.some((t) => candidate.includes(t));

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
        }, terms)) as FoundLink[];
      } catch {
        return [] as FoundLink[];
      }
    })
  );

  const merged = new Map<string, FoundLink>();
  for (const group of results) {
    for (const link of group) {
      if (!link?.url) continue;
      if (!merged.has(link.url)) merged.set(link.url, link);
      if (merged.size >= maxLinks) break;
    }
    if (merged.size >= maxLinks) break;
  }

  return Array.from(merged.values()).slice(0, maxLinks);
}

