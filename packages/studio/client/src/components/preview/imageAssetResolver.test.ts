import { describe, expect, it } from "vitest";
import type { FileTreeNode } from "../asset-explorer/types";
import { resolvePreviewImageAsset } from "./imageAssetResolver";

const assets: FileTreeNode[] = [
  {
    type: "folder",
    name: "public",
    path: "public",
    children: [
      {
        type: "folder",
        name: "images",
        path: "public/images",
        children: [
          {
            type: "file",
            name: "hero shot.png",
            path: "public/images/hero shot.png",
            isImage: true,
          },
        ],
      },
    ],
  },
  {
    type: "folder",
    name: "nested",
    path: "nested",
    children: [
      {
        type: "file",
        name: "team.jpg",
        path: "nested/team.jpg",
        isImage: true,
      },
    ],
  },
];

describe("resolvePreviewImageAsset", () => {
  it("resolves direct project asset URLs", () => {
    const result = resolvePreviewImageAsset({
      projectSlug: "demo",
      version: 3,
      assets,
      imageUrls: [
        `${window.location.origin}/vivd-studio/api/projects/demo/v3/public/images/hero%20shot.png?vivdStudioToken=test`,
      ],
    });

    expect(result?.path).toBe("public/images/hero shot.png");
  });

  it("resolves preview-root public image URLs back to public assets", () => {
    const result = resolvePreviewImageAsset({
      projectSlug: "demo",
      version: 3,
      previewRootUrl: `${window.location.origin}/vivd-studio/api/preview/demo/v3/`,
      assets,
      imageUrls: [
        `${window.location.origin}/vivd-studio/api/preview/demo/v3/images/hero%20shot.png?_vivd=123`,
      ],
    });

    expect(result?.path).toBe("public/images/hero shot.png");
  });

  it("resolves nested relative preview paths to matching assets", () => {
    const result = resolvePreviewImageAsset({
      projectSlug: "demo",
      version: 3,
      previewRootUrl: `${window.location.origin}/vivd-studio/api/preview/demo/v3/`,
      assets,
      imageUrls: [
        `${window.location.origin}/vivd-studio/api/preview/demo/v3/nested/team.jpg`,
      ],
    });

    expect(result?.path).toBe("nested/team.jpg");
  });

  it("ignores external images", () => {
    const result = resolvePreviewImageAsset({
      projectSlug: "demo",
      version: 3,
      assets,
      imageUrls: ["https://cdn.example.com/hero.png"],
    });

    expect(result).toBeNull();
  });
});
