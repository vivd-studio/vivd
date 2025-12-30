import { log } from "./logger.js";

export async function handleCookieBanner(page: any): Promise<void> {
  const terms = [
    "accept",
    "agree",
    "allow",
    "consent",
    "okay",
    "i understand",
    "akzeptiere",
    "zustimmen",
    "verstanden",
  ];

  try {
    const buttons = await page.$$('button, a, div[role="button"]');
    for (const button of buttons) {
      const text = await page.evaluate(
        (el: any) => el.innerText?.toLowerCase(),
        button
      );
      if (text && terms.some((term) => text.includes(term))) {
        log(`Clicking potential cookie button: ${text}`);
        try {
          await button.click();
          await new Promise((r) => setTimeout(r, 1000));
        } catch (e) {
          log(`Error clicking button: ${e}`);
        }
      }
    }
  } catch (e) {
    log(`Error handling cookie banner: ${e}`);
  }

  // Aggressive cleanup: Remove elements that look like cookie banners
  await page.evaluate(() => {
    const cookieKeywords = [
      "cookie",
      "privacy",
      "datenschutz",
      "consent",
      "zustimmung",
    ];
    const elements = document.querySelectorAll(
      "div, section, aside, footer, header"
    );

    elements.forEach((el: any) => {
      const style = window.getComputedStyle(el);
      const isFixedOrSticky =
        style.position === "fixed" || style.position === "sticky";
      const isBottomOrTop = style.bottom === "0px" || style.top === "0px";
      const hasKeywords = cookieKeywords.some((keyword) =>
        el.innerText?.toLowerCase().includes(keyword)
      );

      if ((isFixedOrSticky || isBottomOrTop) && hasKeywords) {
        const rect = el.getBoundingClientRect();
        if (rect.height < window.innerHeight * 0.5) {
          el.remove();
        }
      }
    });
  });
}

export async function autoScroll(page: any): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
