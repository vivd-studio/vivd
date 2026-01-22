import { Request, Response, NextFunction } from "express";

/**
 * Concurrency limiter to prevent overwhelming the scraper service.
 * Limits parallel requests to a configurable maximum.
 *
 * When the limit is reached, new requests wait in a queue until a slot becomes available.
 */
export class ConcurrencyLimiter {
  private activeRequests = 0;
  private queue: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly enableLogging: boolean;

  constructor(maxConcurrent: number, enableLogging = true) {
    this.maxConcurrent = maxConcurrent;
    this.enableLogging = enableLogging;
  }

  private log(message: string): void {
    if (this.enableLogging) {
      console.log(`[${new Date().toISOString()}] ${message}`);
    }
  }

  async acquire(): Promise<void> {
    if (this.activeRequests < this.maxConcurrent) {
      this.activeRequests++;
      this.log(
        `Concurrency: acquired slot (${this.activeRequests}/${this.maxConcurrent} active)`
      );
      return;
    }

    // Wait for a slot to become available
    this.log(
      `Concurrency: slots full (${this.activeRequests}/${this.maxConcurrent}), queueing request (${this.queue.length + 1} waiting)...`
    );
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeRequests++;
        this.log(
          `Concurrency: acquired slot from queue (${this.activeRequests}/${this.maxConcurrent} active, ${this.queue.length} still waiting)`
        );
        resolve();
      });
    });
  }

  release(): void {
    if (this.activeRequests <= 0) {
      this.log("Concurrency: Warning - release called with no active requests");
      return;
    }

    this.activeRequests--;
    this.log(
      `Concurrency: released slot (${this.activeRequests}/${this.maxConcurrent} active, ${this.queue.length} queued)`
    );

    // If someone is waiting, give them the slot
    const waiting = this.queue.shift();
    if (waiting) {
      waiting();
    }
  }

  getStats(): { active: number; queued: number; max: number } {
    return {
      active: this.activeRequests,
      queued: this.queue.length,
      max: this.maxConcurrent,
    };
  }
}

// Default instance for the app
const MAX_CONCURRENT_SCRAPES = parseInt(
  process.env.MAX_CONCURRENT_SCRAPES || "2",
  10
);

const defaultLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_SCRAPES);

/**
 * Middleware that limits concurrent requests.
 * Apply this to resource-intensive routes like /full-scrape and /screenshot.
 */
export function concurrencyLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  defaultLimiter.acquire().then(() => {
    let released = false;
    const releaseOnce = () => {
      if (!released) {
        released = true;
        defaultLimiter.release();
      }
    };

    // Release the slot when the response finishes (success or error)
    res.on("finish", releaseOnce);
    res.on("close", () => {
      // Only release if not already finished (connection dropped)
      if (!res.writableEnded) {
        releaseOnce();
      }
    });
    next();
  });
}

/**
 * Get current concurrency stats for health check / debugging
 */
export function getConcurrencyStats(): {
  active: number;
  queued: number;
  max: number;
} {
  return defaultLimiter.getStats();
}
