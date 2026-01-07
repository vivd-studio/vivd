import puppeteer, { Browser, Page } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerExtra from "puppeteer-extra";

puppeteerExtra.use(StealthPlugin());

const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS || "2", 10);

interface BrowserInstance {
  browser: Browser;
  inUse: boolean;
}

class BrowserPool {
  private pool: BrowserInstance[] = [];
  private queue: Array<(browser: Browser) => void> = [];
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log(`Initializing browser pool with ${MAX_BROWSERS} browsers...`);

    for (let i = 0; i < MAX_BROWSERS; i++) {
      const browser = await this.launchBrowser();
      this.pool.push({ browser, inUse: false });
    }

    this.initialized = true;
    console.log(`Browser pool ready with ${this.pool.length} browsers`);
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

  async acquire(): Promise<Browser> {
    await this.initialize();

    // Find an available browser
    const available = this.pool.find((b) => !b.inUse);
    if (available) {
      available.inUse = true;
      return available.browser;
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
    return page;
  }
}

export const browserPool = new BrowserPool();
