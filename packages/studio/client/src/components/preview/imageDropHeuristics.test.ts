import { describe, expect, it } from "vitest";
import {
  getPreviewImageBaselineSource,
  getPreviewImageDropSupport,
} from "./imageDropHeuristics";

function createImage(html: string): HTMLImageElement {
  document.body.innerHTML = html;
  const image = document.querySelector("img");
  if (!(image instanceof HTMLImageElement)) {
    throw new Error("Expected an img element in test markup");
  }
  return image;
}

describe("getPreviewImageBaselineSource", () => {
  it("falls back to data-original-src before currentSrc", () => {
    const image = createImage('<img data-original-src="/images/original.png" />');
    Object.defineProperty(image, "currentSrc", {
      configurable: true,
      value: "https://preview.example/images/runtime.png",
    });

    expect(getPreviewImageBaselineSource(image)).toBe("/images/original.png");
  });
});

describe("getPreviewImageDropSupport", () => {
  it("rejects dev-server images without CMS ownership or Astro source metadata", () => {
    const image = createImage('<img src="/images/plain.png" />');

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "public/images/replacement.png",
      }),
    ).toMatchObject({
      canDrop: false,
      strategy: null,
    });
  });

  it("allows Astro content-media drops when source metadata is present", () => {
    const image = createImage(
      `
        <section data-astro-source-file="/repo/src/pages/index.astro" data-astro-source-loc="12:4">
          <img src="/images/hero.png" />
        </section>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "src/content/media/shared/new-hero.webp",
      }),
    ).toMatchObject({
      canDrop: true,
      strategy: "astro-import",
      astroSourceFile: "/repo/src/pages/index.astro",
      astroSourceLoc: "12:4",
    });
  });

  it("uses the nearest project Astro source metadata instead of internal Astro Image metadata", () => {
    const image = createImage(
      `
        <section data-astro-source-file="/repo/src/pages/index.astro" data-astro-source-loc="21:7">
          <picture data-astro-source-file="/app/node_modules/astro/components/Image.astro" data-astro-source-loc="10:1">
            <img src="/_image?href=%2Fsrc%2Fcontent%2Fmedia%2Fhero.webp" />
          </picture>
        </section>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "public/favicon.webp",
      }),
    ).toMatchObject({
      canDrop: true,
      strategy: "astro-import",
      astroSourceFile: "/repo/src/pages/index.astro",
      astroSourceLoc: "21:7",
    });
  });

  it("rejects internal-only Astro Image metadata", () => {
    const image = createImage(
      `
        <picture data-astro-source-file="/app/node_modules/astro/components/Image.astro" data-astro-source-loc="10:1">
          <img src="/_image?href=%2Fsrc%2Fcontent%2Fmedia%2Fhero.webp" />
        </picture>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "public/favicon.webp",
      }),
    ).toMatchObject({
      canDrop: false,
      strategy: null,
    });
  });

  it("rejects non-media src/content assets for source-backed Astro drops", () => {
    const image = createImage(
      `
        <section data-astro-source-file="/repo/src/pages/index.astro" data-astro-source-loc="12:4">
          <img src="/images/hero.png" />
        </section>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "src/content/posts/horse/hero.webp",
      }),
    ).toMatchObject({
      canDrop: false,
      strategy: null,
    });
  });

  it("allows legacy static assets by importing them into managed media", () => {
    const image = createImage(
      `
        <section data-astro-source-file="/repo/src/pages/index.astro" data-astro-source-loc="12:4">
          <img src="/images/hero.png" />
        </section>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "images/manual.png",
      }),
    ).toMatchObject({
      canDrop: true,
      strategy: "astro-import",
    });
  });

  it("allows responsive Astro markup for public assets by importing them into managed media", () => {
    const image = createImage(
      `
        <section data-astro-source-file="/repo/src/pages/index.astro" data-astro-source-loc="12:4">
          <picture>
            <source srcset="/images/hero@2x.webp 2x" />
            <img src="/images/hero.webp" />
          </picture>
        </section>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "public/images/replacement.webp",
      }),
    ).toMatchObject({
      canDrop: true,
      strategy: "astro-import",
    });
  });

  it("allows CMS-owned image drops even for responsive markup", () => {
    const image = createImage(
      `
        <figure
          data-cms-collection="pages"
          data-cms-entry="home"
          data-cms-field="hero.image"
          data-cms-kind="asset"
        >
          <picture>
            <source srcset="/images/hero@2x.webp 2x" />
            <img src="/images/hero.webp" />
          </picture>
        </figure>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "devserver",
        assetPath: "src/content/media/shared/new-hero.webp",
      }),
    ).toMatchObject({
      canDrop: true,
      strategy: "cms",
    });
  });

  it("rejects responsive static HTML images", () => {
    const image = createImage(
      `
        <picture>
          <source srcset="/images/hero@2x.webp 2x" />
          <img src="/images/hero.webp" />
        </picture>
      `,
    );

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "static",
        assetPath: "images/replacement.webp",
      }),
    ).toMatchObject({
      canDrop: false,
      strategy: null,
    });
  });

  it("allows plain static HTML images with a stable src", () => {
    const image = createImage('<img src="images/hero.webp" />');

    expect(
      getPreviewImageDropSupport({
        targetImg: image,
        previewMode: "static",
        assetPath: "images/replacement.webp",
      }),
    ).toMatchObject({
      canDrop: true,
      strategy: "static-html",
      baselineSrc: "images/hero.webp",
    });
  });
});
