import { describe, expect, it } from "vitest";

import { rewriteRootAssetUrlsInText } from "./basePathRewrite";

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
});
