import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_LOAD_TIMEOUT_MS } from "@/lib/studioStartupTimings";
import { useStudioIframeLifecycle } from "./useStudioIframeLifecycle";

type LifecycleHarnessProps = Parameters<typeof useStudioIframeLifecycle>[0];

let latestValue: ReturnType<typeof useStudioIframeLifecycle> | null = null;

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

function LifecycleHarness(props: LifecycleHarnessProps) {
  latestValue = useStudioIframeLifecycle(props);
  return <iframe ref={props.iframeRef} title="studio-frame" />;
}

function createLifecycleProps(
  overrides: Partial<LifecycleHarnessProps> = {},
): LifecycleHarnessProps {
  return {
    iframeRef: createRef<HTMLIFrameElement>(),
    studioBaseUrl: "https://app.example.com/_studio/route-1",
    studioHostProbeBaseUrl: "https://app.example.com/_studio/route-1",
    reloadNonce: 0,
    reloadStudioIframe: vi.fn(),
    sidebarOpen: false,
    theme: "light",
    colorTheme: "vivd-sharp",
    setTheme: vi.fn(),
    setColorTheme: vi.fn(),
    onReady: vi.fn(),
    onClose: vi.fn(),
    onFullscreen: vi.fn(),
    onNavigate: vi.fn(),
    onToggleSidebar: vi.fn(),
    onHardRestart: vi.fn(),
    ...overrides,
  };
}

describe("useStudioIframeLifecycle", () => {
  beforeEach(() => {
    latestValue = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("marks the studio ready from an early same-origin iframe load and syncs theme", async () => {
    const props = createLifecycleProps();
    const postMessage = vi.fn();
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameDocument = document.implementation.createHTMLDocument("studio");
    const root = frameDocument.createElement("div");
    root.id = "root";
    root.textContent = "Studio toolbar";
    frameDocument.body.appendChild(root);

    const frameWindow = {
      location: { pathname: "/vivd-studio" },
      postMessage,
    };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => frameDocument,
    });

    await act(async () => {
      latestValue?.handleStudioIframeLoad();
    });

    expect(latestValue?.studioReady).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:ready-ack" },
      "https://app.example.com",
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:theme", theme: "light", colorTheme: "vivd-sharp" },
      "https://app.example.com",
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:sidebar", open: false },
      "https://app.example.com",
    );
    expect(props.onReady).toHaveBeenCalledTimes(1);
  });

  it("forwards hard-restart requests from the studio iframe", async () => {
    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame") as HTMLIFrameElement;
    const frameWindow = { location: { pathname: "/vivd-studio" } };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:hardRestart", version: 7 },
          origin: "https://app.example.com",
          source: frameWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(props.onHardRestart).toHaveBeenCalledWith(7);
  });

  it("normalizes deprecated studio color themes back to vivd-sharp", async () => {
    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame") as HTMLIFrameElement;
    const frameWindow = {
      location: { pathname: "/vivd-studio" },
      postMessage: vi.fn(),
    };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });
    const messageSource = iframe.contentWindow as unknown as MessageEventSource;

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "vivd:studio:theme",
            theme: "dark",
            colorTheme: "aurora",
          },
          origin: "https://app.example.com",
          source: messageSource,
        }),
      );
    });

    expect(props.setTheme).toHaveBeenCalledWith("dark");
    expect(props.setColorTheme).toHaveBeenCalledWith("vivd-sharp");
  });

  it("forwards sidebar peek lifecycle requests from the studio iframe", async () => {
    const onShowSidebarPeek = vi.fn();
    const onScheduleHideSidebarPeek = vi.fn();
    const props = createLifecycleProps({
      onShowSidebarPeek,
      onScheduleHideSidebarPeek,
    });
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameWindow = { location: { pathname: "/vivd-studio" } };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:showSidebarPeek" },
          origin: "https://app.example.com",
          source: frameWindow as unknown as MessageEventSource,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:scheduleHideSidebarPeek" },
          origin: "https://app.example.com",
          source: frameWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(onShowSidebarPeek).toHaveBeenCalledTimes(1);
    expect(onScheduleHideSidebarPeek).toHaveBeenCalledTimes(1);
  });

  it("forwards transport-degraded signals from the studio iframe", async () => {
    const onTransportDegraded = vi.fn();
    const props = createLifecycleProps({
      onTransportDegraded,
    });
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameWindow = { location: { pathname: "/vivd-studio" } };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "vivd:studio:transport-degraded",
            transport: "trpc-http",
            reason: "timeout",
          },
          origin: "https://app.example.com",
          source: frameWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(onTransportDegraded).toHaveBeenCalledWith({
      transport: "trpc-http",
      reason: "timeout",
    });
  });

  it("keeps requesting a ready handshake for cross-origin iframes until the studio responds", async () => {
    const props = createLifecycleProps({
      studioBaseUrl: "https://studio.example.com/runtime",
      studioHostProbeBaseUrl: null,
    });
    const postMessage = vi.fn();

    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameWindow = { postMessage };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:ready-check" },
      "https://studio.example.com",
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:theme", theme: "light", colorTheme: "vivd-sharp" },
      "https://studio.example.com",
    );
    expect(latestValue?.studioReady).toBe(false);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:ready" },
          origin: "https://studio.example.com",
          source: frameWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(latestValue?.studioReady).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:ready-ack" },
      "https://studio.example.com",
    );
    expect(props.onReady).toHaveBeenCalledTimes(1);
  });

  it("reveals a cross-origin studio on presented before bridge-ready", async () => {
    const props = createLifecycleProps({
      studioBaseUrl: "https://studio.example.com/runtime",
      studioHostProbeBaseUrl: null,
    });
    const postMessage = vi.fn();

    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameWindow = { postMessage };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vivd:studio:presented" },
          origin: "https://studio.example.com",
          source: frameWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(latestValue?.studioVisible).toBe(true);
    expect(latestValue?.studioReady).toBe(false);
    expect(latestValue?.studioLifecycleState).toBe("bridge_pending");
    expect(props.onReady).not.toHaveBeenCalled();
  });

  it("rechecks same-origin iframe readiness when the page is restored", async () => {
    const props = createLifecycleProps();
    const postMessage = vi.fn();
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameDocument = document.implementation.createHTMLDocument("studio");
    const root = frameDocument.createElement("div");
    root.id = "root";
    root.textContent = "Studio already mounted";
    frameDocument.body.appendChild(root);

    const frameWindow = {
      location: { pathname: "/vivd-studio" },
      postMessage,
    };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => frameDocument,
    });

    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(latestValue?.studioReady).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:ready-ack" },
      "https://app.example.com",
    );
    expect(props.onReady).toHaveBeenCalledTimes(1);
  });

  it("can keep sending bridge messages before a cross-origin iframe exposes its location", async () => {
    const props = createLifecycleProps({
      studioBaseUrl: "https://studio.example.com/runtime",
      studioHostProbeBaseUrl: null,
    });
    const postMessage = vi.fn();
    let committedToStudioOrigin = false;

    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameWindow = {
      postMessage,
      get location() {
        if (committedToStudioOrigin) {
          throw new Error("Cross-origin frame");
        }
        return {
          origin: window.location.origin,
          pathname: "/",
        };
      },
    };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "vivd:host:ready-check" },
      "https://studio.example.com",
    );

    committedToStudioOrigin = true;
  });

  it("reloads early when a cross-origin studio iframe is still stuck on about:blank", async () => {
    const props = createLifecycleProps({
      studioBaseUrl: "https://studio.example.com/runtime",
      studioHostProbeBaseUrl: null,
    });

    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameWindow = {
      postMessage: vi.fn(),
      location: {
        href: "about:blank",
      },
    };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_900);
    });

    expect(props.reloadStudioIframe).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(props.reloadStudioIframe).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(props.reloadStudioIframe).toHaveBeenCalledTimes(1);
  });

  it("polls runtime health after a load timeout and reloads once the runtime is healthy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createHealthResponse(false))
      .mockResolvedValueOnce(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUDIO_LOAD_TIMEOUT_MS);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.example.com/_studio/route-1/health",
      expect.objectContaining({
        method: "GET",
        mode: "cors",
        cache: "no-store",
      }),
    );
    expect(props.reloadStudioIframe).toHaveBeenCalledTimes(1);
  });

  it("self-heals earlier when the runtime is healthy but the iframe never becomes ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_900);
    });

    expect(props.reloadStudioIframe).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.example.com/_studio/route-1/health",
      expect.objectContaining({
        method: "GET",
        mode: "cors",
        cache: "no-store",
      }),
    );
    expect(props.reloadStudioIframe).toHaveBeenCalledTimes(1);
  });

  it("does not treat startup-stub health payloads as an early-ready signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(false));
    vi.stubGlobal("fetch", fetchMock);

    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_200);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.example.com/_studio/route-1/health",
      expect.objectContaining({
        method: "GET",
        mode: "cors",
        cache: "no-store",
      }),
    );
    expect(props.reloadStudioIframe).not.toHaveBeenCalled();
  });

  it("falls back to a one-shot iframe reload when the studio only exposes a cross-origin browser url", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const props = createLifecycleProps({
      studioBaseUrl: "https://studio.example.com/runtime",
      studioHostProbeBaseUrl: null,
    });
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameWindow = {
      postMessage: vi.fn(),
      location: {
        href: "https://studio.example.com/runtime/vivd-studio",
      },
    };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUDIO_LOAD_TIMEOUT_MS + 1_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.reloadStudioIframe).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUDIO_LOAD_TIMEOUT_MS + 1_000);
    });

    expect(props.reloadStudioIframe).toHaveBeenCalledTimes(1);
  });

  it("only surfaces iframe errors after they persist beyond the startup grace window", async () => {
    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    act(() => {
      latestValue?.handleStudioIframeError({
        message: "Invalid bootstrap token",
        source: "bootstrap",
      });
    });

    expect(latestValue?.studioLoadErrored).toBe(false);
    expect(latestValue?.studioLoadError).toMatchObject({
      message: "Invalid bootstrap token",
      source: "bootstrap",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });

    expect(latestValue?.studioLoadErrored).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(latestValue?.studioLoadErrored).toBe(true);
  });

  it("surfaces structured terminal bootstrap failures immediately", async () => {
    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    act(() => {
      latestValue?.handleStudioIframeError({
        message: "Studio bootstrap is not configured",
        code: "bootstrap_unconfigured",
        retryable: false,
        source: "bootstrap",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(latestValue?.studioLoadErrored).toBe(true);
    expect(latestValue?.studioLifecycleState).toBe("terminal_failure");
  });

  it("does not reload a presented studio just because bridge-ready is late", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createHealthResponse(true));
    vi.stubGlobal("fetch", fetchMock);
    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    const iframe = screen.getByTitle("studio-frame");
    const frameDocument = document.implementation.createHTMLDocument("studio");
    const root = frameDocument.createElement("div");
    root.id = "root";
    frameDocument.body.appendChild(root);
    Object.defineProperty(frameDocument, "readyState", {
      configurable: true,
      value: "complete",
    });
    const frameWindow = {
      location: { pathname: "/vivd-studio" },
      postMessage: vi.fn(),
    };

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => frameWindow,
    });
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => frameDocument,
    });

    await act(async () => {
      latestValue?.handleStudioIframeLoad();
    });

    expect(latestValue?.studioVisible).toBe(true);
    expect(latestValue?.studioReady).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STUDIO_LOAD_TIMEOUT_MS + 1_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.reloadStudioIframe).not.toHaveBeenCalled();
    expect(latestValue?.studioLifecycleState).toBe("bridge_pending");
  });

  it("keeps the startup skeleton when a transient iframe error recovers quickly", async () => {
    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    act(() => {
      latestValue?.handleStudioIframeError({
        message: "Studio is starting up. Please retry shortly.",
        source: "bootstrap",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    act(() => {
      latestValue?.handleStudioIframeLoad();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(latestValue?.studioLoadErrored).toBe(false);
    expect(latestValue?.studioLoadError).toBeNull();
  });
});
