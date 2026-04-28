import { describe, expect, it } from "vitest";
import {
  classifyImageAssetPath,
  computeImageDropPlan,
  resolveCmsDropMode,
} from "./imageDropPlan";
import type { CmsPreviewBinding } from "@/lib/cmsPreviewBindings";

const cmsBinding: CmsPreviewBinding = {
  modelKey: "blog",
  entryKey: "welcome",
  fieldPath: ["heroImage"],
  kind: "asset",
};

const cmsTarget = {
  kind: "cms-asset-field" as const,
  cmsBinding,
  baselineSrc: "/_image?href=hero.webp",
  astroSourceFile: "/repo/src/pages/index.astro",
  astroSourceLoc: "12:4",
};

describe("classifyImageAssetPath", () => {
  it("classifies shared, entry-owned, managed, public, working, and static assets", () => {
    expect(classifyImageAssetPath("src/content/media/shared/hero.webp", cmsBinding)).toBe(
      "shared",
    );
    expect(classifyImageAssetPath("src/content/media/hero.webp", cmsBinding)).toBe(
      "shared",
    );
    expect(classifyImageAssetPath("src/content/media/blog/welcome/hero.webp", cmsBinding)).toBe(
      "entry",
    );
    expect(classifyImageAssetPath("src/content/media/blog/other/hero.webp", cmsBinding)).toBe(
      "managed",
    );
    expect(classifyImageAssetPath("public/images/hero.webp", cmsBinding)).toBe("public");
    expect(classifyImageAssetPath(".vivd/dropped-images/hero.webp", cmsBinding)).toBe(
      "working",
    );
    expect(classifyImageAssetPath("images/hero.webp", cmsBinding)).toBe("legacy-static");
  });
});

describe("computeImageDropPlan", () => {
  it("uses a shared library asset on a CMS entry without asking", () => {
    const plan = computeImageDropPlan({
      assetPath: "src/content/media/shared/hero.webp",
      target: cmsTarget,
    });

    expect(plan).toMatchObject({
      kind: "set-cms-reference",
      canDrop: true,
      assetScope: "shared",
      requiresChoice: false,
    });
    expect(plan.choices).toEqual([]);
    expect(resolveCmsDropMode(plan)).toBe("reference");
  });

  it("asks when a managed asset appears to belong to another CMS entry", () => {
    const plan = computeImageDropPlan({
      assetPath: "src/content/media/blog/other/hero.webp",
      target: cmsTarget,
    });

    expect(plan).toMatchObject({
      kind: "set-cms-reference",
      canDrop: true,
      assetScope: "managed",
      requiresChoice: true,
    });
    expect(plan.choices.map((choice) => choice.kind)).toEqual([
      "copy-to-entry",
      "use-existing",
    ]);
  });

  it("uses an entry-owned asset directly when it belongs to the same CMS entry", () => {
    const plan = computeImageDropPlan({
      assetPath: "src/content/media/blog/welcome/hero.webp",
      target: cmsTarget,
    });

    expect(plan).toMatchObject({
      kind: "set-cms-reference",
      canDrop: true,
      assetScope: "entry",
      requiresChoice: false,
    });
    expect(resolveCmsDropMode(plan)).toBe("reference");
  });

  it("imports a working asset into a CMS entry without asking", () => {
    const plan = computeImageDropPlan({
      assetPath: ".vivd/dropped-images/hero.webp",
      target: cmsTarget,
    });

    expect(plan).toMatchObject({
      kind: "import-working-asset",
      canDrop: true,
      assetScope: "working",
      requiresChoice: false,
    });
    expect(plan.choices).toEqual([]);
    expect(resolveCmsDropMode(plan)).toBe("copy-to-entry");
  });

  it("copies a public asset into a CMS entry without asking", () => {
    const plan = computeImageDropPlan({
      assetPath: "public/images/hero.webp",
      target: cmsTarget,
    });

    expect(plan).toMatchObject({
      kind: "copy-to-cms-entry",
      canDrop: true,
      assetScope: "public",
      requiresChoice: false,
    });
    expect(plan.choices).toEqual([]);
    expect(resolveCmsDropMode(plan)).toBe("copy-to-entry");
  });

  it("allows source-backed Astro drops for managed media", () => {
    const plan = computeImageDropPlan({
      assetPath: "src/content/media/shared/hero.webp",
      target: {
        kind: "astro-source-image",
        astroSourceFile: "/repo/src/pages/index.astro",
        astroSourceLoc: "12:4",
        baselineSrc: "/images/old.webp",
        hasResponsiveMarkup: true,
      },
    });

    expect(plan).toMatchObject({
      kind: "set-astro-source-image",
      canDrop: true,
      assetScope: "shared",
    });
    expect(plan.writes[0]).toMatchObject({
      type: "astro-source",
      mode: "content-import",
    });
  });

  it("copies public drops into managed media for source-backed Astro images", () => {
    const plan = computeImageDropPlan({
      assetPath: "public/images/hero.webp",
      target: {
        kind: "astro-source-image",
        astroSourceFile: "/repo/src/pages/index.astro",
        astroSourceLoc: "12:4",
        baselineSrc: "/images/old.webp",
        hasResponsiveMarkup: true,
      },
    });

    expect(plan).toMatchObject({
      kind: "set-astro-source-image",
      canDrop: true,
      assetScope: "public",
    });
    expect(plan.writes[0]).toMatchObject({
      type: "astro-source",
      mode: "copy-to-managed-import",
    });
  });

  it("copies legacy static drops into managed media for source-backed Astro images", () => {
    const plan = computeImageDropPlan({
      assetPath: "images/hero.webp",
      target: {
        kind: "astro-source-image",
        astroSourceFile: "/repo/src/pages/index.astro",
        astroSourceLoc: "12:4",
        baselineSrc: "/images/old.webp",
        hasResponsiveMarkup: true,
      },
    });

    expect(plan).toMatchObject({
      kind: "set-astro-source-image",
      canDrop: true,
      assetScope: "legacy-static",
    });
    expect(plan.writes[0]).toMatchObject({
      type: "astro-source",
      mode: "copy-to-managed-import",
    });
  });

  it("blocks responsive static HTML drops", () => {
    const plan = computeImageDropPlan({
      assetPath: "images/hero.webp",
      target: {
        kind: "static-html-image",
        baselineSrc: "images/old.webp",
        hasResponsiveMarkup: true,
      },
    });

    expect(plan).toMatchObject({
      kind: "blocked",
      canDrop: false,
    });
  });
});
