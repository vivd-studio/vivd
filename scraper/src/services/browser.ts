import puppeteer, { Browser, Page } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerExtra from "puppeteer-extra";

// NOTE: The default `iframe.contentWindow` stealth evasion breaks layout on some sites
// (e.g. ten-it.de ends up with `body { width: 4000px }`, pushing content off-screen).
// Disabling just this evasion keeps most stealth benefits while avoiding the rendering bug.
const stealth = StealthPlugin();
stealth.enabledEvasions.delete("iframe.contentWindow");
puppeteerExtra.use(stealth);

const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS || "2", 10);

interface BrowserInstance {
  browser: Browser;
  inUse: boolean;
}

class BrowserPool {
  private pool: BrowserInstance[] = [];
  private queue: Array<(browser: Browser) => void> = [];
  private initialized = false;
  private spawning = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log(`Initializing browser pool (max ${MAX_BROWSERS} browsers, lazy spawn)...`);

    const browser = await this.launchBrowser();
    this.pool.push({ browser, inUse: false });

    this.initialized = true;
    console.log(`Browser pool ready with 1 browser (will scale up to ${MAX_BROWSERS} on demand)`);
  }

  private async launchBrowser(): Promise<Browser> {
    return puppeteerExtra.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        // Prevent Chromium from auto-upgrading HTTP navigations to HTTPS
        // (breaks HTTP-only sites and shows up as net::ERR_BLOCKED_BY_CLIENT).
        "--disable-features=HttpsFirstBalancedMode,HttpsUpgrades",
      ],
    });
  }

  private async spawnAdditionalBrowser(): Promise<void> {
    if (this.spawning || this.pool.length >= MAX_BROWSERS) return;

    this.spawning = true;
    try {
      console.log(`Spawning additional browser (${this.pool.length + 1}/${MAX_BROWSERS})...`);
      const browser = await this.launchBrowser();
      this.pool.push({ browser, inUse: false });
      console.log(`Browser pool now has ${this.pool.length} browsers`);

      // If someone was waiting, give them the new browser
      const waiting = this.queue.shift();
      if (waiting) {
        const instance = this.pool[this.pool.length - 1];
        instance.inUse = true;
        waiting(instance.browser);
      }
    } finally {
      this.spawning = false;
    }
  }

  async acquire(): Promise<Browser> {
    await this.initialize();

    // Find an available browser
    const available = this.pool.find((b) => !b.inUse);
    if (available) {
      available.inUse = true;
      return available.browser;
    }

    // No available browser - spawn a new one if under limit
    if (this.pool.length < MAX_BROWSERS) {
      this.spawnAdditionalBrowser();
    }

    // Wait for a browser to become available
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(browser: Browser): void {
    const instance = this.pool.find((b) => b.browser === browser);
    if (instance) {
      instance.inUse = false;

      // If someone is waiting, give them the browser
      const waiting = this.queue.shift();
      if (waiting) {
        instance.inUse = true;
        waiting(browser);
      }
    }
  }

  async createPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Set extra headers that many sites check for
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    });

    return page;
  }
}

export const browserPool = new BrowserPool();
