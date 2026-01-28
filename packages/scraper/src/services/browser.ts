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

// Proxy configuration (optional - only used when PROXY_HOST is set)
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT || "823";
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;
const PROXY_ENABLED = !!PROXY_HOST;

let browserIdCounter = 0;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Check if an error indicates a broken browser (protocol timeout, disconnected, etc.)
 */
export function isBrowserError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("protocol") ||
    message.includes("timed out") ||
    message.includes("navigation timeout") ||
    message.includes("target closed") ||
    message.includes("session closed") ||
    message.includes("connection closed") ||
    message.includes("browser disconnected") ||
    message.includes("browser has disconnected") ||
    message.includes("network.enable timed out") ||
    message.includes("runtime.callfunctionon timed out") ||
    message.includes("runtime.evaluate timed out")
  );
}

interface BrowserInstance {
  browser: Browser;
  inUse: boolean;
  id: number;
}

class BrowserPool {
  private pool: BrowserInstance[] = [];
  private queue: Array<(browser: Browser) => void> = [];
  private initialized = false;
  private spawning = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    log(`Initializing browser pool (max ${MAX_BROWSERS} browsers, lazy spawn)...`);
    if (PROXY_ENABLED) {
      log(`Proxy enabled: ${PROXY_HOST}:${PROXY_PORT}`);
    }

    const browser = await this.launchBrowser();
    const id = ++browserIdCounter;
    this.pool.push({ browser, inUse: false, id });

    this.initialized = true;
    log(`Browser pool ready with 1 browser (will scale up to ${MAX_BROWSERS} on demand)`);
  }

  private async launchBrowser(): Promise<Browser> {
    const args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      // Prevent Chromium from auto-upgrading HTTP navigations to HTTPS
      // (breaks HTTP-only sites and shows up as net::ERR_BLOCKED_BY_CLIENT).
      "--disable-features=HttpsFirstBalancedMode,HttpsUpgrades",
    ];

    // Add proxy server arg if configured
    if (PROXY_ENABLED) {
      args.push(`--proxy-server=${PROXY_HOST}:${PROXY_PORT}`);
    }

    return puppeteerExtra.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      // Increase protocol timeout to prevent premature disconnects
      protocolTimeout: 180000, // 3 minutes
      args,
    });
  }

  private async spawnAdditionalBrowser(): Promise<void> {
    if (this.spawning || this.pool.length >= MAX_BROWSERS) return;

    this.spawning = true;
    try {
      log(`Spawning additional browser (${this.pool.length + 1}/${MAX_BROWSERS})...`);
      const browser = await this.launchBrowser();
      const id = ++browserIdCounter;
      this.pool.push({ browser, inUse: false, id });
      log(`Browser pool now has ${this.pool.length} browsers`);

      // If someone was waiting, give them the new browser
      const waiting = this.queue.shift();
      if (waiting) {
        const instance = this.pool[this.pool.length - 1];
        instance.inUse = true;
        waiting(instance.browser);
      }
    } catch (error) {
      log(`Failed to spawn browser: ${error}`);
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
      log(`Acquired browser #${available.id}`);
      return available.browser;
    }

    // No available browser - spawn a new one if under limit
    if (this.pool.length < MAX_BROWSERS) {
      this.spawnAdditionalBrowser();
    }

    // Wait for a browser to become available
    log(`All browsers busy, waiting in queue (${this.queue.length + 1} waiting)...`);
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release a browser back to the pool.
   * If unhealthy=true, the browser will be closed and removed, and a new one spawned.
   */
  release(browser: Browser, unhealthy = false): void {
    const instanceIndex = this.pool.findIndex((b) => b.browser === browser);
    if (instanceIndex === -1) {
      log("Warning: Tried to release unknown browser");
      return;
    }

    const instance = this.pool[instanceIndex];

    if (unhealthy) {
      log(`Browser #${instance.id} marked unhealthy, closing and removing from pool...`);
      // Remove from pool first
      this.pool.splice(instanceIndex, 1);
      // Close browser in background (don't await, it might be stuck)
      browser.close().catch((e) => log(`Error closing unhealthy browser: ${e}`));
      log(`Browser pool now has ${this.pool.length} browsers after removal`);

      // Spawn a replacement if we're under the max
      if (this.pool.length < MAX_BROWSERS) {
        this.spawnAdditionalBrowser();
      }

      // If someone is waiting and we have an available browser, serve them
      if (this.queue.length > 0) {
        const availableBrowser = this.pool.find((b) => !b.inUse);
        if (availableBrowser) {
          const waiting = this.queue.shift();
          if (waiting) {
            availableBrowser.inUse = true;
            waiting(availableBrowser.browser);
          }
        }
      }
      return;
    }

    // Normal release - mark as available
    instance.inUse = false;
    log(`Released browser #${instance.id}`);

    // If someone is waiting, give them the browser
    const waiting = this.queue.shift();
    if (waiting) {
      instance.inUse = true;
      waiting(browser);
    }
  }

  async createPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Authenticate with proxy if configured
    if (PROXY_ENABLED && PROXY_USERNAME && PROXY_PASSWORD) {
      await page.authenticate({
        username: PROXY_USERNAME,
        password: PROXY_PASSWORD,
      });
    }

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

  /**
   * Get pool stats for debugging/health checks
   */
  getStats(): { total: number; inUse: number; queued: number } {
    return {
      total: this.pool.length,
      inUse: this.pool.filter((b) => b.inUse).length,
      queued: this.queue.length,
    };
  }
}

export const browserPool = new BrowserPool();
