import { describe, expect, it } from "vitest";
import {
  buildRelativeReferencePath,
  getCmsEntryFileFormat,
  isPathInsideRoot,
  isWritableCmsEntryFile,
  shouldRenderImageAssetField,
  shouldRenderImageAssetListField,
  resolveRelativePath,
  serializeCmsEntryValues,
  titleizeKey,
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

  it("detects writable Astro entry file formats", () => {
    expect(getCmsEntryFileFormat("src/content/blog/post.yaml")).toBe("yaml");
    expect(getCmsEntryFileFormat("src/content/blog/post.json")).toBe("json");
    expect(getCmsEntryFileFormat("src/content/blog/post.mdx")).toBe("markdown");
    expect(isWritableCmsEntryFile("src/content/blog/post.markdown")).toBe(true);
    expect(isWritableCmsEntryFile("src/content/blog/post.txt")).toBe(false);
  });

  it("serializes markdown entries by replacing frontmatter and preserving body", () => {
    const content = serializeCmsEntryValues(
      "src/content/blog/post.mdx",
      {
        title: "Updated",
        order: 2,
      },
      `---
title: Old
order: 1
---

# Hello

Body content.
`,
    );

    expect(content).toContain("title: Updated");
    expect(content).toContain("order: 2");
    expect(content).toContain("# Hello");
    expect(content).toContain("Body content.");
  });

  it("treats obvious string image fields as image assets in the Studio editor", () => {
    expect(
      shouldRenderImageAssetField("profileImage", { type: "string" }, ""),
    ).toBe(true);
    expect(
      shouldRenderImageAssetField(
        "hero",
        { type: "string" },
        "../media/horse/apollo/portrait.webp",
      ),
    ).toBe(true);
    expect(
      shouldRenderImageAssetField(
        "profileImage",
        { type: "string" },
        "https://cdn.example.com/avatar.webp",
      ),
    ).toBe(false);
  });

  it("treats obvious string-list image fields as image asset lists in the Studio editor", () => {
    expect(
      shouldRenderImageAssetListField(
        "galleryImages",
        { type: "list", item: { type: "string" } },
        [],
      ),
    ).toBe(true);
    expect(
      shouldRenderImageAssetListField(
        "gallery",
        { type: "list", item: { type: "string" } },
        ["../media/horse/apollo/1.webp", "../media/horse/apollo/2.webp"],
      ),
    ).toBe(true);
    expect(
      shouldRenderImageAssetListField(
        "galleryImages",
        { type: "list", item: { type: "string" } },
        ["https://cdn.example.com/1.webp"],
      ),
    ).toBe(false);
  });

  it("builds human-readable labels from camelCase field keys", () => {
    expect(titleizeKey("profileImage")).toBe("Profile Image");
    expect(titleizeKey("galleryImages")).toBe("Gallery Images");
  });
});
