import { describe, expect, it } from "vitest";
import {
  buildRelativeReferencePath,
  isPathInsideRoot,
  resolveRelativePath,
} from "./helpers";

describe("cms helpers", () => {
  it("builds a relative asset reference from an entry file to a media file", () => {
    const entryPath = "src/content/collections/horse/apollo/index.yaml";
    const mediaPath = "src/content/media/horse/apollo/portrait.webp";

    expect(buildRelativeReferencePath(entryPath, mediaPath)).toBe(
      "../../../media/horse/apollo/portrait.webp",
    );
  });

  it("round-trips relative references through resolveRelativePath", () => {
    const entryPath = "src/content/collections/horse/apollo/index.yaml";
    const mediaPath = "src/content/media/horse/apollo/portrait.webp";
    const relativePath = buildRelativeReferencePath(entryPath, mediaPath);

    expect(resolveRelativePath(entryPath, relativePath)).toBe(mediaPath);
  });

  it("checks whether a candidate path stays inside the CMS media root", () => {
    expect(isPathInsideRoot("src/content/media/horse/apollo/portrait.webp", "src/content/media")).toBe(
      true,
    );
    expect(isPathInsideRoot("src/content/collections/horse/apollo/index.yaml", "src/content/media")).toBe(
      false,
    );
  });
});
