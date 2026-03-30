import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioIframeLifecycle } from "./useStudioIframeLifecycle";

type LifecycleHarnessProps = Parameters<typeof useStudioIframeLifecycle>[0];

let latestValue: ReturnType<typeof useStudioIframeLifecycle> | null = null;

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
    reloadNonce: 0,
    reloadStudioIframe: vi.fn(),
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
      { type: "vivd:host:theme", theme: "light", colorTheme: "vivd-sharp" },
      "https://app.example.com",
    );
    expect(props.onReady).toHaveBeenCalledTimes(1);
  });

  it("forwards hard-restart requests from the studio iframe", async () => {
    const props = createLifecycleProps();
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
          data: { type: "vivd:studio:hardRestart", version: 7 },
          origin: "https://app.example.com",
          source: frameWindow as unknown as MessageEventSource,
        }),
      );
    });

    expect(props.onHardRestart).toHaveBeenCalledWith(7);
  });

  it("polls runtime health after a load timeout and reloads once the runtime is healthy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const props = createLifecycleProps();
    render(<LifecycleHarness {...props} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
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
});
