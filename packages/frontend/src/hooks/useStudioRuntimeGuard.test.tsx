import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioRuntimeGuard } from "./useStudioRuntimeGuard";

type GuardHarnessProps = Parameters<typeof useStudioRuntimeGuard>[0];

let latestValue: ReturnType<typeof useStudioRuntimeGuard> | null = null;

function createHealthResponse(ready: boolean): Response {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(
      ready
        ? { status: "ok", initialized: true }
        : { status: "starting", initialized: false },
    ),
  } as unknown as Response;
}

function GuardHarness(props: GuardHarnessProps) {
  latestValue = useStudioRuntimeGuard(props);
  return null;
}

describe("useStudioRuntimeGuard", () => {
  beforeEach(() => {
    latestValue = null;
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
      bootstrapToken: "token-1",
    });
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio.example.com"
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
      browserUrl: null,
      runtimeUrl: "https://studio.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-1",
      userActionToken: null,
    });
    expect(touchStudio).toHaveBeenCalled();
  });

  it("does not wake studio when a follow-up check succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const ensureStudioRunning = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio.example.com",
      bootstrapToken: null,
    });
    const touchStudio = vi.fn();
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio.example.com"
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
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const ensureStudioRunning = vi.fn();
    const onRecovered = vi.fn();
    const touchStudioInitial = vi.fn();

    const { rerender } = render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio.example.com"
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
        studioProbeBaseUrl="https://studio.example.com"
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

  it("rechecks and wakes the studio when the tab regains focus after the runtime went offline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const touchStudio = vi.fn();
    const ensureStudioRunning = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio-recovered.example.com",
      runtimeUrl: "https://studio-recovered.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-2",
      userActionToken: "user-action-2",
    });
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio.example.com"
        touchStudio={touchStudio}
        ensureStudioRunning={ensureStudioRunning}
        onRecovered={onRecovered}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ensureStudioRunning).not.toHaveBeenCalled();

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("offline after suspend"));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(ensureStudioRunning).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledWith({
      url: "https://studio-recovered.example.com",
      browserUrl: null,
      runtimeUrl: "https://studio-recovered.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-2",
      userActionToken: "user-action-2",
    });
    expect(touchStudio).toHaveBeenCalled();
  });

  it("rechecks and wakes the studio when the page is restored", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const touchStudio = vi.fn();
    const ensureStudioRunning = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio-recovered.example.com",
      runtimeUrl: "https://studio-recovered.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-2",
      userActionToken: "user-action-2",
    });
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio.example.com"
        touchStudio={touchStudio}
        ensureStudioRunning={ensureStudioRunning}
        onRecovered={onRecovered}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ensureStudioRunning).not.toHaveBeenCalled();

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("offline after restore"));

    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(ensureStudioRunning).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledWith({
      url: "https://studio-recovered.example.com",
      browserUrl: null,
      runtimeUrl: "https://studio-recovered.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-2",
      userActionToken: "user-action-2",
    });
    expect(touchStudio).toHaveBeenCalled();
  });

  it("runs an immediate retry-on-fail check when the studio iframe reports a transport failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const touchStudio = vi.fn();
    const ensureStudioRunning = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio-recovered.example.com",
      runtimeUrl: "https://studio-recovered.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-3",
      userActionToken: "user-action-3",
    });
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio.example.com"
        touchStudio={touchStudio}
        ensureStudioRunning={ensureStudioRunning}
        onRecovered={onRecovered}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("network down"));

    await act(async () => {
      latestValue?.requestRecoveryCheck();
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(ensureStudioRunning).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledWith({
      url: "https://studio-recovered.example.com",
      browserUrl: null,
      runtimeUrl: "https://studio-recovered.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-3",
      userActionToken: "user-action-3",
    });
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

      return Promise.resolve(createHealthResponse(true));
    });
    vi.stubGlobal("fetch", fetchMock);

    const ensureStudioRunningA = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio-a-recovered.example.com",
      bootstrapToken: null,
    });
    const onRecoveredA = vi.fn();

    const { rerender } = render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio-a.example.com"
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
      bootstrapToken: null,
    });
    const onRecoveredB = vi.fn();

    rerender(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio-b.example.com"
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

  it("keeps path-prefixed runtime URLs when probing health", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://app.example.com/_studio/route-1/"
        touchStudio={vi.fn()}
        ensureStudioRunning={vi.fn()}
        onRecovered={vi.fn()}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.example.com/_studio/route-1/health",
      expect.objectContaining({
        method: "GET",
        mode: "cors",
        cache: "no-store",
      }),
    );
  });

  it("treats startup-stub health payloads as not ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createHealthResponse(false))
      .mockResolvedValueOnce(createHealthResponse(false))
      .mockResolvedValueOnce(createHealthResponse(false));
    vi.stubGlobal("fetch", fetchMock);

    const ensureStudioRunning = vi.fn().mockResolvedValue({
      success: true as const,
      url: "https://studio.example.com",
      bootstrapToken: "token-4",
    });
    const onRecovered = vi.fn();

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl="https://studio.example.com"
        touchStudio={vi.fn()}
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
      browserUrl: null,
      runtimeUrl: "https://studio.example.com",
      compatibilityUrl: null,
      bootstrapToken: "token-4",
      userActionToken: null,
    });
  });

  it("stays idle when no host-safe probe url is available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const touchStudio = vi.fn();

    render(
      <GuardHarness
        enabled
        studioProbeBaseUrl={null}
        touchStudio={touchStudio}
        ensureStudioRunning={vi.fn()}
        onRecovered={vi.fn()}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(touchStudio).toHaveBeenCalled();
  });

  it("stays fully idle when the guard is disabled", async () => {
    const fetchMock = vi.fn();
    const touchStudio = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GuardHarness
        enabled={false}
        studioProbeBaseUrl={null}
        touchStudio={touchStudio}
        ensureStudioRunning={vi.fn()}
        onRecovered={vi.fn()}
        timing={timing}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(touchStudio).not.toHaveBeenCalled();
  });
});
