export type FixedWindowCounterResult = {
  count: number;
  resetAt: number;
};

export interface LimiterStore {
  incrementFixedWindow(options: {
    key: string;
    windowMs: number;
    now: number;
  }): Promise<FixedWindowCounterResult>;
}

export class InMemoryLimiterStore implements LimiterStore {
  private readonly counters = new Map<string, { count: number; windowStart: number }>();

  async incrementFixedWindow(options: {
    key: string;
    windowMs: number;
    now: number;
  }): Promise<FixedWindowCounterResult> {
    const existing = this.counters.get(options.key);
    if (
      !existing ||
      options.now - existing.windowStart >= options.windowMs
    ) {
      this.counters.set(options.key, {
        count: 1,
        windowStart: options.now,
      });
      return {
        count: 1,
        resetAt: options.now + options.windowMs,
      };
    }

    existing.count += 1;
    this.counters.set(options.key, existing);
    return {
      count: existing.count,
      resetAt: existing.windowStart + options.windowMs,
    };
  }
}
