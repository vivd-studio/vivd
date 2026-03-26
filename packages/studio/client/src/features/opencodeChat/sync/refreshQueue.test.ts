import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshQueue } from "./refreshQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createRefreshQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces repeated refresh requests into a single in-flight retry", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const queue = createRefreshQueue({
      paused: () => false,
      refresh,
    });

    queue.refresh();
    queue.refresh();

    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);

    queue.refresh();
    first.resolve();

    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);

    queue.dispose();
  });

  it("does not run queued work until refresh is requested again after pause lifts", async () => {
    vi.useFakeTimers();
    let paused = true;
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const queue = createRefreshQueue({
      paused: () => paused,
      refresh,
    });

    queue.refresh();
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();

    paused = false;
    queue.refresh();
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);

    queue.dispose();
  });
});
