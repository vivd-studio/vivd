import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportVivdStudioTransportDegraded,
  resetVivdStudioTransportDegradedSignalForTests,
} from "./hostRuntimeSignals";

const { postVivdHostMessage } = vi.hoisted(() => ({
  postVivdHostMessage: vi.fn(),
}));

vi.mock("@/lib/hostBridge", () => ({
  postVivdHostMessage,
}));

describe("hostRuntimeSignals", () => {
  const originalParent = window.parent;

  beforeEach(() => {
    vi.useFakeTimers();
    resetVivdStudioTransportDegradedSignalForTests();
    postVivdHostMessage.mockReset();
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: originalParent,
    });
  });

  it("rate limits repeated transport-degraded signals", () => {
    expect(
      reportVivdStudioTransportDegraded({
        transport: "trpc-http",
        reason: "network-error",
      }),
    ).toBe(true);
    expect(
      reportVivdStudioTransportDegraded({
        transport: "trpc-http",
        reason: "timeout",
      }),
    ).toBe(false);

    expect(postVivdHostMessage).toHaveBeenCalledTimes(1);
    expect(postVivdHostMessage).toHaveBeenCalledWith({
      type: "vivd:studio:transport-degraded",
      transport: "trpc-http",
      reason: "network-error",
    });

    vi.advanceTimersByTime(5_001);

    expect(
      reportVivdStudioTransportDegraded({
        transport: "trpc-http",
        reason: "timeout",
      }),
    ).toBe(true);
    expect(postVivdHostMessage).toHaveBeenCalledTimes(2);
  });
});
