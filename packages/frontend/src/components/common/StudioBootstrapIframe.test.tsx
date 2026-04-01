import "@testing-library/jest-dom/vitest";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioBootstrapIframe } from "./StudioBootstrapIframe";

describe("StudioBootstrapIframe", () => {
  const originalContentWindow = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    "contentWindow",
  );

  let frameHref = "about:blank";

  beforeEach(() => {
    frameHref = "about:blank";
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("submits the bootstrap form immediately when bootstrap is enabled", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});

    renderBootstrapIframe();

    expect(submitSpy).toHaveBeenCalledTimes(1);
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
