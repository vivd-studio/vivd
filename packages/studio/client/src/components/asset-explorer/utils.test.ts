import { describe, expect, it } from "vitest";
import { File, FileCode, FileText, Image as ImageIcon } from "lucide-react";
import {
  ASTRO_CONTENT_MEDIA_PATH,
  buildAssetFileUrl,
  buildImageUrl,
  buildProjectFileUrl,
  canDragAssetToPreview,
  getStudioImageUrlCandidates,
  getFileTreeIconComponent,
  isVivdInternalAssetPath,
  pickInitialAssetExplorerPath,
} from "./utils";

describe("getFileTreeIconComponent", () => {
  it("uses chevrons only for folders by omitting a folder icon", () => {
    expect(
      getFileTreeIconComponent({
        name: "src",
        type: "folder",
        path: "src",
      })
    ).toBeNull();
  });

  it("returns neutral file icons for common asset types", () => {
    expect(
      getFileTreeIconComponent({
        name: "hero.png",
        type: "file",
        path: "hero.png",
        isImage: true,
      })
    ).toMatchObject({
      icon: ImageIcon,
      className: "text-muted-foreground",
    });

    expect(
      getFileTreeIconComponent({
        name: "index.tsx",
        type: "file",
        path: "src/index.tsx",
      })
    ).toMatchObject({
      icon: FileCode,
      className: "text-muted-foreground",
    });

    expect(
      getFileTreeIconComponent({
        name: "deck.pdf",
        type: "file",
        path: "deck.pdf",
        mimeType: "application/pdf",
      })
    ).toMatchObject({
      icon: FileText,
      className: "text-muted-foreground",
    });

    expect(
      getFileTreeIconComponent({
        name: "archive.zip",
        type: "file",
        path: "archive.zip",
      })
    ).toMatchObject({
      icon: File,
      className: "text-muted-foreground",
    });
  });
});

describe("asset explorer path helpers", () => {
  it("treats .vivd paths as internal working assets", () => {
    expect(isVivdInternalAssetPath(".vivd/uploads/logo.png")).toBe(true);
    expect(isVivdInternalAssetPath("\\.vivd\\uploads\\logo.png")).toBe(true);
    expect(isVivdInternalAssetPath("images/logo.png")).toBe(false);
  });

  it("allows preview dragging for non-internal asset paths", () => {
    expect(canDragAssetToPreview(".vivd/uploads/logo.png")).toBe(false);
    expect(canDragAssetToPreview("public/images/logo.png")).toBe(true);
    expect(canDragAssetToPreview("src/content/media/shared/logo.png")).toBe(
      true,
    );
  });

  it("builds raw asset URLs for image and document viewers", () => {
    expect(buildImageUrl("demo", 3, ".vivd/uploads/hero image.webp")).toBe(
      "/vivd-studio/api/assets/demo/3?path=.vivd%2Fuploads%2Fhero%20image.webp",
    );
  });

  it("provides both asset and project-file URL candidates for runtime fallback", () => {
    expect(
      getStudioImageUrlCandidates("demo", 3, ".vivd/uploads/hero image.webp"),
    ).toEqual([
      buildAssetFileUrl("demo", 3, ".vivd/uploads/hero image.webp"),
      buildProjectFileUrl("demo", 3, ".vivd/uploads/hero image.webp"),
    ]);
  });

  it("keeps regular public image URLs on the pathname form", () => {
    expect(buildAssetFileUrl("demo", 3, "images/hero image.webp")).toBe(
      "/vivd-studio/api/assets/demo/3/images/hero%20image.webp",
    );
    expect(buildProjectFileUrl("demo", 3, "images/hero image.webp")).toBe(
      "/vivd-studio/api/projects/demo/v3/images/hero%20image.webp",
    );
  });

  it("keeps startup focused on public/project image folders instead of hidden uploads", () => {
    expect(
      pickInitialAssetExplorerPath({
        isAstroProject: false,
        uploadsHasItems: true,
        publicImagesHasItems: true,
        imagesHasItems: true,
      })
    ).toBe("public/images");

    expect(
      pickInitialAssetExplorerPath({
        isAstroProject: false,
        uploadsHasItems: true,
        publicImagesHasItems: false,
        imagesHasItems: true,
      })
    ).toBe("images");
  });

  it("pins Astro projects to the canonical content media root", () => {
    expect(
      pickInitialAssetExplorerPath({
        isAstroProject: true,
        uploadsHasItems: false,
        publicImagesHasItems: true,
        imagesHasItems: true,
      })
    ).toBe(ASTRO_CONTENT_MEDIA_PATH);
  });
});
