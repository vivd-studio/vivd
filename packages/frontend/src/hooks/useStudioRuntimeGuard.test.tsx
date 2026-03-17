import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioRuntimeGuard } from "./useStudioRuntimeGuard";

type GuardHarnessProps = Parameters<typeof useStudioRuntimeGuard>[0];

function GuardHarness(props: GuardHarnessProps) {
  useStudioRuntimeGuard(props);
  return null;
}

describe("useStudioRuntimeGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const timing = {
    heartbeatIntervalMs: 10_000,
    retryDelayMs: 1,
    healthTimeoutMs: 5,
    failureThreshold: 2,
    recoveryCooldownMs: 1_000,
  };

  it("wakes studio after consecutive failed health checks", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const touchStudio = vi.fn();
    const ensureStudioRunning = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio.example.com",
      accessToken: "token-1",
    });
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioBaseUrl="https://studio.example.com"
        touchStudio={touchStudio}
        ensureStudioRunning={ensureStudioRunning}
        onRecovered={onRecovered}
        timing={{ ...timing, heartbeatIntervalMs: 10, healthTimeoutMs: 100 }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(ensureStudioRunning).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledWith({
      url: "https://studio.example.com",
      accessToken: "token-1",
    });
    expect(touchStudio).toHaveBeenCalled();
  });

  it("does not wake studio when a follow-up check succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const ensureStudioRunning = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio.example.com",
      accessToken: null,
    });
    const touchStudio = vi.fn();
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioBaseUrl="https://studio.example.com"
        touchStudio={touchStudio}
        ensureStudioRunning={ensureStudioRunning}
        onRecovered={onRecovered}
        timing={{ ...timing, heartbeatIntervalMs: 10, healthTimeoutMs: 100 }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });

    expect(ensureStudioRunning).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("does not rerun the immediate probe when callback props change", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const ensureStudioRunning = vi.fn();
    const onRecovered = vi.fn();
    const touchStudioInitial = vi.fn();

    const { rerender } = render(
      <GuardHarness
        enabled
        studioBaseUrl="https://studio.example.com"
        touchStudio={touchStudioInitial}
        ensureStudioRunning={ensureStudioRunning}
        onRecovered={onRecovered}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(touchStudioInitial).toHaveBeenCalledTimes(1);

    const touchStudioNext = vi.fn();
    rerender(
      <GuardHarness
        enabled
        studioBaseUrl="https://studio.example.com"
        touchStudio={touchStudioNext}
        ensureStudioRunning={ensureStudioRunning}
        onRecovered={onRecovered}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(touchStudioNext).not.toHaveBeenCalled();
  });

  it("ignores stale failed probes after switching to a new studio target", async () => {
    const createAbortError = () => {
      const error = new Error("Aborted");
      error.name = "AbortError";
      return error;
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("studio-a.example.com")) {
        return new Promise((_, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(createAbortError());
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(createAbortError()),
            { once: true },
          );
        });
      }

      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ensureStudioRunningA = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio-a-recovered.example.com",
      accessToken: null,
    });
    const onRecoveredA = vi.fn();

    const { rerender } = render(
      <GuardHarness
        enabled
        studioBaseUrl="https://studio-a.example.com"
        touchStudio={vi.fn()}
        ensureStudioRunning={ensureStudioRunningA}
        onRecovered={onRecoveredA}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const ensureStudioRunningB = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio-b.example.com",
      accessToken: null,
    });
    const onRecoveredB = vi.fn();

    rerender(
      <GuardHarness
        enabled
        studioBaseUrl="https://studio-b.example.com"
        touchStudio={vi.fn()}
        ensureStudioRunning={ensureStudioRunningB}
        onRecovered={onRecoveredB}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(ensureStudioRunningA).not.toHaveBeenCalled();
    expect(onRecoveredA).not.toHaveBeenCalled();
    expect(ensureStudioRunningB).not.toHaveBeenCalled();
    expect(onRecoveredB).not.toHaveBeenCalled();
  });
});
