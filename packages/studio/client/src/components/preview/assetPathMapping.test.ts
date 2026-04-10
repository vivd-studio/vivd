import { describe, expect, it } from "vitest";
import { toAstroRuntimeAssetPath } from "./assetPathMapping";

describe("toAstroRuntimeAssetPath", () => {
  it("maps canonical content media files to the /media runtime path", () => {
    expect(
      toAstroRuntimeAssetPath(
        "src/content/media/brands/logo.png",
        "/images/old-logo.png",
      ),
    ).toBe("/media/brands/logo.png");
  });

  it("preserves relative formatting when the baseline src was relative", () => {
    expect(
      toAstroRuntimeAssetPath(
        "src/content/media/pages/home/hero.webp",
        "images/hero.webp",
      ),
    ).toBe("media/pages/home/hero.webp");
  });

  it("keeps legacy public assets on the public URL form", () => {
    expect(
      toAstroRuntimeAssetPath("public/images/legacy-logo.png", "/images/old.png"),
    ).toBe("/images/legacy-logo.png");
  });

  it("leaves non-managed paths unchanged", () => {
    expect(toAstroRuntimeAssetPath("images/manual.png", "/images/old.png")).toBe(
      "/images/manual.png",
    );
  });
});
