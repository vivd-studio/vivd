import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCacheBustedPreviewUrl,
  buildPreviewUrl,
  getDesktopPaneOrder,
  getInitialPanelOpenState,
  getPreviewPathFromUrl,
  getPreviewRootUrl,
  normalizePreviewPathInput,
} from "./navigation";

describe("preview navigation helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults the Studio panels to chat open and explorer closed on first load", () => {
    expect(getInitialPanelOpenState(window.localStorage)).toEqual({
      chatOpen: true,
      assetsOpen: false,
    });
  });

  it("restores persisted panel visibility and keeps the desktop order fixed", () => {
    window.localStorage.setItem("previewModal.chatOpen", "false");
    window.localStorage.setItem("previewModal.assetsOpen", "true");

    expect(getInitialPanelOpenState(window.localStorage)).toEqual({
      chatOpen: false,
      assetsOpen: true,
    });
    expect(getDesktopPaneOrder({ chatOpen: true, assetsOpen: true })).toEqual([
      "chat",
      "assets",
      "preview",
    ]);
  });

  it("normalizes browser-bar input into preview paths", () => {
    expect(normalizePreviewPathInput("login?tab=security#email")).toBe(
      "/login?tab=security#email",
    );
    expect(normalizePreviewPathInput("?draft=1")).toBe("/?draft=1");
    expect(normalizePreviewPathInput("/login?_vivd=0_0&tab=security")).toBe(
      "/login?tab=security",
    );
    expect(normalizePreviewPathInput("/#home?_vivd=0_0")).toBe("/#home");
    expect(normalizePreviewPathInput("/#/pricing?tab=plans&_vivd=0_0")).toBe(
      "/#/pricing?tab=plans",
    );
    expect(normalizePreviewPathInput("https://example.com/account#billing")).toBe(
      "/account#billing",
    );
  });

  it("builds preview URLs from the current route and rehydrates them back into relative paths", () => {
    const previewRootUrl = getPreviewRootUrl(
      "http://localhost/vivd-studio/api/preview/demo/v1/index.html",
      "static",
    );
    const fullUrl = buildPreviewUrl(previewRootUrl, "/products/tea?ref=hero#buy");

    expect(fullUrl).toBe(
      "http://localhost/vivd-studio/api/preview/demo/v1/products/tea?ref=hero#buy",
    );
    expect(getPreviewPathFromUrl(fullUrl, previewRootUrl)).toBe(
      "/products/tea?ref=hero#buy",
    );
    expect(
      getPreviewPathFromUrl(
        "http://localhost/vivd-studio/api/preview/demo/v1/index.html",
        previewRootUrl,
      ),
    ).toBe("/");
    expect(
      getPreviewPathFromUrl(
        "http://localhost/vivd-studio/api/preview/demo/v1/login?_vivd=0_0&tab=security#email",
        previewRootUrl,
      ),
    ).toBe("/login?tab=security#email");
    expect(
      getPreviewPathFromUrl(
        "http://localhost/vivd-studio/api/preview/demo/v1/index.html?_vivd=4_0#home?_vivd=2_0",
        previewRootUrl,
      ),
    ).toBe("/#home");
  });

  it("cache-busts preview refreshes in the real query string instead of inside hash routes", () => {
    expect(
      buildCacheBustedPreviewUrl(
        "http://localhost/vivd-studio/api/preview/demo/v1/index.html#home",
        "4_0",
      ),
    ).toBe("http://localhost/vivd-studio/api/preview/demo/v1/index.html?_vivd=4_0#home");
    expect(
      buildCacheBustedPreviewUrl(
        "http://localhost/vivd-studio/api/preview/demo/v1/index.html?tab=hero#home?_vivd=2_0",
        "5_0",
      ),
    ).toBe(
      "http://localhost/vivd-studio/api/preview/demo/v1/index.html?tab=hero&_vivd=5_0#home",
    );
  });
});
