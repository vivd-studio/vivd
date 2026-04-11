import { describe, expect, it } from "vitest";
import { toAstroRuntimeAssetPath } from "./assetPathMapping";

describe("toAstroRuntimeAssetPath", () => {
  it("does not invent public runtime URLs for src/content/media assets", () => {
    expect(
      toAstroRuntimeAssetPath(
        "src/content/media/brands/logo.png",
        "/images/old-logo.png",
      ),
    ).toBeNull();
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
