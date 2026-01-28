import { describe, it, expect, beforeEach } from "vitest";
import { ConcurrencyLimiter } from "./concurrency.js";

describe("ConcurrencyLimiter", () => {
  let limiter: ConcurrencyLimiter;

  beforeEach(() => {
    // Create a fresh limiter with logging disabled for cleaner test output
    limiter = new ConcurrencyLimiter(2, false);
  });

  describe("acquire", () => {
    it("should allow acquiring slots up to the limit", async () => {
      await limiter.acquire();
      expect(limiter.getStats().active).toBe(1);

      await limiter.acquire();
      expect(limiter.getStats().active).toBe(2);
    });

    it("should queue requests when limit is reached", async () => {
      // Fill up the slots
      await limiter.acquire();
      await limiter.acquire();
      expect(limiter.getStats().active).toBe(2);
      expect(limiter.getStats().queued).toBe(0);

      // This should queue
      let thirdAcquired = false;
      const thirdPromise = limiter.acquire().then(() => {
        thirdAcquired = true;
      });

      // Give the promise a chance to resolve (it shouldn't)
      await new Promise((r) => setTimeout(r, 10));

      expect(thirdAcquired).toBe(false);
      expect(limiter.getStats().queued).toBe(1);

      // Release a slot - the queued request should now acquire
      limiter.release();
      await thirdPromise;

      expect(thirdAcquired).toBe(true);
      expect(limiter.getStats().active).toBe(2);
      expect(limiter.getStats().queued).toBe(0);
    });

    it("should serve queued requests in FIFO order", async () => {
      const order: number[] = [];

      // Fill up slots
      await limiter.acquire();
      await limiter.acquire();

      // Queue multiple requests
      const p1 = limiter.acquire().then(() => order.push(1));
      const p2 = limiter.acquire().then(() => order.push(2));
      const p3 = limiter.acquire().then(() => order.push(3));

      expect(limiter.getStats().queued).toBe(3);

      // Release slots one by one
      limiter.release();
      await p1;
      expect(order).toEqual([1]);

      limiter.release();
      await p2;
      expect(order).toEqual([1, 2]);

      limiter.release();
      await p3;
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("release", () => {
    it("should decrement active count", async () => {
      await limiter.acquire();
      await limiter.acquire();
      expect(limiter.getStats().active).toBe(2);

      limiter.release();
      expect(limiter.getStats().active).toBe(1);

      limiter.release();
      expect(limiter.getStats().active).toBe(0);
    });

    it("should not go below zero when releasing with no active requests", () => {
      // This should not throw and should not go negative
      limiter.release();
      expect(limiter.getStats().active).toBe(0);

      limiter.release();
      expect(limiter.getStats().active).toBe(0);
    });

    it("should immediately serve a queued request when releasing", async () => {
      await limiter.acquire();
      await limiter.acquire();

      let queued = false;
      const queuedPromise = limiter.acquire().then(() => {
        queued = true;
      });

      // Give it time to queue
      await new Promise((r) => setTimeout(r, 10));
      expect(queued).toBe(false);
      expect(limiter.getStats().active).toBe(2);
      expect(limiter.getStats().queued).toBe(1);

      // Release should immediately serve the queued request
      limiter.release();

      // The promise should resolve synchronously after release
      await queuedPromise;
      expect(queued).toBe(true);
      // Active should still be 2 because the queued request took the slot
      expect(limiter.getStats().active).toBe(2);
      expect(limiter.getStats().queued).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return correct initial stats", () => {
      const stats = limiter.getStats();
      expect(stats).toEqual({
        active: 0,
        queued: 0,
        max: 2,
      });
    });

    it("should reflect the configured max", () => {
      const limiter5 = new ConcurrencyLimiter(5, false);
      expect(limiter5.getStats().max).toBe(5);
    });

    it("should accurately track complex scenarios", async () => {
      // Acquire 2
      await limiter.acquire();
      await limiter.acquire();

      // Queue 3
      const p1 = limiter.acquire();
      const p2 = limiter.acquire();
      const p3 = limiter.acquire();

      expect(limiter.getStats()).toEqual({
        active: 2,
        queued: 3,
        max: 2,
      });

      // Release 2, which serves 2 from queue
      limiter.release();
      await p1;
      limiter.release();
      await p2;

      expect(limiter.getStats()).toEqual({
        active: 2,
        queued: 1,
        max: 2,
      });

      // Release all
      limiter.release();
      await p3;
      limiter.release();
      limiter.release();

      expect(limiter.getStats()).toEqual({
        active: 0,
        queued: 0,
        max: 2,
      });
    });
  });

  describe("concurrent usage", () => {
    it("should handle many concurrent requests", async () => {
      const limiter10 = new ConcurrencyLimiter(3, false);
      const results: number[] = [];

      // Fire 10 requests concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        limiter10.acquire().then(() => {
          results.push(i);
          // Simulate some work
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              limiter10.release();
              resolve();
            }, 10);
          });
        })
      );

      // At most 3 should be active at any time
      // (we can't easily assert this mid-execution, but we can check final state)
      await Promise.all(promises);

      // All 10 should have completed
      expect(results.length).toBe(10);
      expect(limiter10.getStats().active).toBe(0);
      expect(limiter10.getStats().queued).toBe(0);
    });
  });
});
