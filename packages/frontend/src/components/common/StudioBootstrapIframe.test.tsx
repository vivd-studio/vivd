import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioBootstrapIframe } from "./StudioBootstrapIframe";

describe("StudioBootstrapIframe", () => {
  const originalContentWindow = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    "contentWindow",
  );
  const originalContentDocument = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    "contentDocument",
  );

  let frameHref = "about:blank";
  let frameBodyText = "";

  beforeEach(() => {
    frameHref = "about:blank";
    frameBodyText = "";
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return {
          location: {
            get href() {
              return frameHref;
            },
          },
        };
      },
    });
    Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
      configurable: true,
      get() {
        const doc = document.implementation.createHTMLDocument("iframe");
        doc.body.textContent = frameBodyText;
        return doc;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalContentWindow) {
      Object.defineProperty(
        HTMLIFrameElement.prototype,
        "contentWindow",
        originalContentWindow,
      );
    } else {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        configurable: true,
        get() {
          return null;
        },
      });
    }
    if (originalContentDocument) {
      Object.defineProperty(
        HTMLIFrameElement.prototype,
        "contentDocument",
        originalContentDocument,
      );
    } else {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
        configurable: true,
        get() {
          return null;
        },
      });
    }
  });

  function renderBootstrapIframe(overrides: Partial<React.ComponentProps<typeof StudioBootstrapIframe>> = {}) {
    const iframeRef = createRef<HTMLIFrameElement>();

    return render(
      <StudioBootstrapIframe
        iframeRef={iframeRef}
        iframeName="vivd-studio-embedded-site-1-v1"
        iframeKey="site-1-v1"
        title="Vivd Studio - site-1"
        cleanSrc="http://app.localhost:4100/vivd-studio?embedded=1"
        bootstrapAction="http://app.localhost:4100/vivd-studio/api/bootstrap"
        bootstrapToken="bootstrap-1"
        userActionToken="user-action-1"
        submissionKey="site-1-v1-http://app.localhost:4100-0"
        {...overrides}
      />,
    );
  }

  function createBootstrapStatusResponse(
    payload: unknown,
    options: { status?: number; retryAfter?: string } = {},
  ): Response {
    const status = options.status ?? 200;
    const headers = new Map<string, string>([
      ["content-type", "application/json"],
    ]);
    if (options.retryAfter) {
      headers.set("retry-after", options.retryAfter);
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => headers.get(name.toLowerCase()) ?? null,
      },
      clone() {
        return this;
      },
      json: vi.fn().mockResolvedValue(payload),
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    } as unknown as Response;
  }

  it("submits the bootstrap form immediately when bootstrap is enabled", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});

    renderBootstrapIframe();

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it("waits for bootstrap status readiness before submitting the bootstrap form", async () => {
    vi.useFakeTimers();
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createBootstrapStatusResponse(
          {
            status: "starting",
            code: "runtime_starting",
            retryable: true,
            canBootstrap: false,
            message: "Studio is starting",
          },
          { status: 503, retryAfter: "1.5" },
        ),
      )
      .mockResolvedValueOnce(
        createBootstrapStatusResponse({
          status: "ready",
          retryable: false,
          canBootstrap: true,
          message: "Studio is ready",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      renderBootstrapIframe({
        bootstrapStatusUrl:
          "http://app.localhost:4100/vivd-studio/api/bootstrap-status",
      });

      expect(submitSpy).not.toHaveBeenCalled();

      await act(async () => {
        await Promise.resolve();
      });

      expect(submitSpy).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://app.localhost:4100/vivd-studio/api/bootstrap-status",
        expect.objectContaining({
          method: "GET",
          mode: "cors",
          cache: "no-store",
        }),
      );
      expect(submitSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries bootstrap while the iframe remains on about:blank", async () => {
    vi.useFakeTimers();
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});

    try {
      renderBootstrapIframe();
      expect(submitSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(submitSpy).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });
      expect(submitSpy).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying once the iframe has navigated away from about:blank", async () => {
    vi.useFakeTimers();
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});

    try {
      renderBootstrapIframe();
      expect(submitSpy).toHaveBeenCalledTimes(1);

      frameHref = "http://app.localhost:4100/vivd-studio?embedded=1";

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_100);
      });

      expect(submitSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries one bootstrap-class failure silently before surfacing it", () => {
    frameHref = "http://app.localhost:4100/vivd-studio/api/bootstrap";
    frameBodyText = '{"error":"Invalid bootstrap token"}';
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const onLoad = vi.fn();
    const onError = vi.fn();

    renderBootstrapIframe({ onLoad, onError });
    expect(submitSpy).toHaveBeenCalledTimes(1);

    fireEvent.load(screen.getByTitle("Vivd Studio - site-1"));

    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(submitSpy).toHaveBeenCalledTimes(2);

    fireEvent.load(screen.getByTitle("Vivd Studio - site-1"));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Invalid bootstrap token",
        source: "bootstrap",
      }),
    );
  });

  it("keeps the startup skeleton path for transient bootstrap startup responses and retries", async () => {
    vi.useFakeTimers();
    frameHref = "http://app.localhost:4100/vivd-studio/api/bootstrap";
    frameBodyText = "Studio is starting up. Please retry shortly.";
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const onLoad = vi.fn();
    const onError = vi.fn();

    try {
      renderBootstrapIframe({ onLoad, onError });
      expect(submitSpy).toHaveBeenCalledTimes(1);

      fireEvent.load(screen.getByTitle("Vivd Studio - site-1"));

      expect(onLoad).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(submitSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resubmits when the clean target changes while the iframe is still blank", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});

    const view = renderBootstrapIframe();
    expect(submitSpy).toHaveBeenCalledTimes(1);

    view.rerender(
      <StudioBootstrapIframe
        iframeRef={createRef<HTMLIFrameElement>()}
        iframeName="vivd-studio-embedded-site-1-v1"
        iframeKey="site-1-v1"
        title="Vivd Studio - site-1"
        cleanSrc="http://app.localhost:4100/vivd-studio?embedded=1&sessionId=sess-1"
        bootstrapAction="http://app.localhost:4100/vivd-studio/api/bootstrap"
        bootstrapToken="bootstrap-1"
        userActionToken="user-action-1"
        submissionKey="site-1-v1-http://app.localhost:4100-0"
      />,
    );

    expect(submitSpy).toHaveBeenCalledTimes(2);
  });

  it("does not resubmit on target changes once the iframe has already navigated", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});

    const iframeRef = createRef<HTMLIFrameElement>();
    const view = render(
      <StudioBootstrapIframe
        iframeRef={iframeRef}
        iframeName="vivd-studio-embedded-site-1-v1"
        iframeKey="site-1-v1"
        title="Vivd Studio - site-1"
        cleanSrc="http://app.localhost:4100/vivd-studio?embedded=1"
        bootstrapAction="http://app.localhost:4100/vivd-studio/api/bootstrap"
        bootstrapToken="bootstrap-1"
        userActionToken="user-action-1"
        submissionKey="site-1-v1-http://app.localhost:4100-0"
      />,
    );
    expect(submitSpy).toHaveBeenCalledTimes(1);

    frameHref = "http://app.localhost:4100/vivd-studio?embedded=1";

    view.rerender(
      <StudioBootstrapIframe
        iframeRef={iframeRef}
        iframeName="vivd-studio-embedded-site-1-v1"
        iframeKey="site-1-v1"
        title="Vivd Studio - site-1"
        cleanSrc="http://app.localhost:4100/vivd-studio?embedded=1&sessionId=sess-1"
        bootstrapAction="http://app.localhost:4100/vivd-studio/api/bootstrap"
        bootstrapToken="bootstrap-1"
        userActionToken="user-action-1"
        submissionKey="site-1-v1-http://app.localhost:4100-0"
      />,
    );

    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});
