import { describe, expect, it } from "vitest";

import {
  rewriteRootAssetUrlsInText,
  rewriteViteHmrWebSocketUrl,
  stripDevServerToolingFromHtml,
} from "./basePathRewrite";

describe("rewriteRootAssetUrlsInText", () => {
  it("rewrites root-relative src attributes", () => {
    expect(
      rewriteRootAssetUrlsInText(
        '<img src="/images/hero.jpg" alt="Hero">',
        "/_studio/runtime-123/vivd-studio/api/preview/site/v1",
      ),
    ).toContain(
      'src="/_studio/runtime-123/vivd-studio/api/preview/site/v1/images/hero.jpg"',
    );
  });

  it("rewrites root-relative srcset candidates", () => {
    expect(
      rewriteRootAssetUrlsInText(
        '<source srcset="/images/hero.webp 1x, /images/hero@2x.webp 2x">',
        "/_studio/runtime-123/vivd-studio/api/preview/site/v1",
      ),
    ).toContain(
      'srcset="/_studio/runtime-123/vivd-studio/api/preview/site/v1/images/hero.webp 1x, /_studio/runtime-123/vivd-studio/api/preview/site/v1/images/hero@2x.webp 2x"',
    );
  });

  it("rewrites root-relative URLs inside inline style attributes", () => {
    expect(
      rewriteRootAssetUrlsInText(
        '<div style="background-image:url(\'/images/hero.jpg\')"></div>',
        "/_studio/runtime-123/vivd-studio/api/preview/site/v1",
      ),
    ).toContain(
      "style=\"background-image:url('/_studio/runtime-123/vivd-studio/api/preview/site/v1/images/hero.jpg')\"",
    );
  });

  it("rewrites the injected preview bridge script source for path-mounted runtimes", () => {
    expect(
      rewriteRootAssetUrlsInText(
        '<script src="/vivd-studio/api/preview-bridge.js"></script>',
        "/_studio/runtime-123",
      ),
    ).toContain(
      'src="/_studio/runtime-123/vivd-studio/api/preview-bridge.js"',
    );
  });

  it("rewrites same-origin Vite HMR websocket URLs onto the mounted base path", () => {
    expect(
      rewriteViteHmrWebSocketUrl(
        "wss://default.vivd.studio/?token=test-token",
        "/_studio/runtime-123",
        "https://default.vivd.studio/_studio/runtime-123/vivd-studio?embedded=1",
        "vite-hmr",
      ),
    ).toBe("wss://default.vivd.studio/_studio/runtime-123/?token=test-token");
  });

  it("rewrites the invalid localhost:undefined Vite fallback onto the mounted base path", () => {
    expect(
      rewriteViteHmrWebSocketUrl(
        "wss://localhost:undefined/?token=test-token",
        "/_studio/runtime-123",
        "https://default.vivd.studio/_studio/runtime-123/vivd-studio?embedded=1",
        "vite-hmr",
      ),
    ).toBe("wss://default.vivd.studio/_studio/runtime-123/?token=test-token");
  });
});

describe("stripDevServerToolingFromHtml", () => {
  it("preserves @vite/client while removing Astro dev-toolbar assets", () => {
    const html = `
      <head>
        <script type="module" src="/@vite/client"></script>
        <script type="module" src="/node_modules/astro/dev-toolbar/entrypoint.js"></script>
        <link rel="stylesheet" href="/node_modules/astro/dev-toolbar/app.css">
      </head>
    `;

    const stripped = stripDevServerToolingFromHtml(html);

    expect(stripped).toContain("/@vite/client");
    expect(stripped).not.toContain("dev-toolbar/entrypoint.js");
    expect(stripped).not.toContain("dev-toolbar/app.css");
  });
});
