import { describe, expect, it } from "vitest";

import {
  isStudioIframePresented,
  isStudioIframeShellLoaded,
} from "./studioIframeReady";

function createIframe(options: {
  pathname?: string;
  frameDocument: Document;
}): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    get() {
      return {
        location: {
          pathname: options.pathname ?? "/_studio/runtime-123/vivd-studio",
        },
      };
    },
  });
  Object.defineProperty(iframe, "contentDocument", {
    configurable: true,
    get() {
      return options.frameDocument;
    },
  });
  return iframe;
}

describe("isStudioIframeShellLoaded", () => {
  it("treats a mounted studio root as ready even without matching asset tags", () => {
    const frameDocument = document.implementation.createHTMLDocument("studio");
    const root = frameDocument.createElement("div");
    root.id = "root";
    const mountedApp = frameDocument.createElement("div");
    mountedApp.textContent = "Studio toolbar";
    root.append(mountedApp);
    frameDocument.body.append(root);

    expect(
      isStudioIframeShellLoaded(
        createIframe({
          frameDocument,
        }),
      ),
    ).toBe(true);
  });

  it("still accepts the static shell when the asset path matches", () => {
    const frameDocument = document.implementation.createHTMLDocument("studio");
    const root = frameDocument.createElement("div");
    root.id = "root";
    frameDocument.body.append(root);
    const script = frameDocument.createElement("script");
    script.setAttribute(
      "src",
      "/_studio/runtime-123/vivd-studio/assets/index-abc123.js",
    );
    frameDocument.head.append(script);

    expect(
      isStudioIframeShellLoaded(
        createIframe({
          frameDocument,
        }),
      ),
    ).toBe(true);
  });
});

describe("isStudioIframePresented", () => {
  it("does not present the initial about:blank bootstrap shell", () => {
    const frameDocument = document.implementation.createHTMLDocument("loading");
    const iframe = document.createElement("iframe");

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get() {
        return {
          location: {
            href: "about:blank",
            pathname: "/_studio/runtime-123/vivd-studio",
          },
        };
      },
    });
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        return frameDocument;
      },
    });

    expect(isStudioIframePresented(iframe)).toBe(false);
  });

  it("treats cross-origin runtime documents as presented once navigation leaves about:blank", () => {
    const iframe = document.createElement("iframe");

    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get() {
        return {
          get location() {
            throw new DOMException("Blocked", "SecurityError");
          },
        };
      },
    });

    expect(isStudioIframePresented(iframe)).toBe(true);
  });
});
