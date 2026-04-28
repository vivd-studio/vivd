import { describe, expect, it } from "vitest";
import { File, FileCode, FileText, Image as ImageIcon } from "lucide-react";
import {
  ASTRO_CONTENT_MEDIA_PATH,
  ASTRO_SHARED_MEDIA_PATH,
  buildAssetFileUrl,
  buildImageUrl,
  buildProjectFileUrl,
  canDragAssetToPreview,
  getStudioImageUrlCandidates,
  getFileTreeIconComponent,
  getAssetScopeLabel,
  isAstroManagedMediaPath,
  isVivdInternalAssetPath,
  pickAssetCreationTargetPath,
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

  it("keeps generated Astro assets in managed media folders", () => {
    expect(isAstroManagedMediaPath("src/content/media/shared/logo.png")).toBe(
      true,
    );
    expect(isAstroManagedMediaPath("src/content/posts/logo.png")).toBe(false);
    expect(isAstroManagedMediaPath("public/images/logo.png")).toBe(false);

    expect(
      pickAssetCreationTargetPath({
        isAstroProject: true,
        currentPath: ASTRO_CONTENT_MEDIA_PATH,
        fallbackGalleryPath: ASTRO_CONTENT_MEDIA_PATH,
      }),
    ).toBe(ASTRO_SHARED_MEDIA_PATH);

    expect(
      pickAssetCreationTargetPath({
        isAstroProject: true,
        currentPath: "src/content/media/products",
        fallbackGalleryPath: ASTRO_CONTENT_MEDIA_PATH,
      }),
    ).toBe("src/content/media/products");

    expect(
      pickAssetCreationTargetPath({
        isAstroProject: true,
        currentPath: "public/images",
        fallbackGalleryPath: ASTRO_CONTENT_MEDIA_PATH,
      }),
    ).toBe(ASTRO_SHARED_MEDIA_PATH);
  });

  it("labels managed asset scopes for gallery cards", () => {
    expect(getAssetScopeLabel("src/content/media/shared/logo.png")).toBe(
      "shared",
    );
    expect(getAssetScopeLabel("src/content/media/products/apollo/logo.png")).toBe(
      "products/apollo",
    );
    expect(getAssetScopeLabel("src/content/media/products/logo.png")).toBe("products");
    expect(getAssetScopeLabel("public/images/logo.png")).toBe("public");
    expect(getAssetScopeLabel(".vivd/uploads/logo.png")).toBe("working");
    expect(getAssetScopeLabel("images/logo.png")).toBeNull();
  });

  it("keeps static asset creation in the visible project asset folder", () => {
    expect(
      pickAssetCreationTargetPath({
        isAstroProject: false,
        currentPath: "public/images",
        fallbackGalleryPath: "public/images",
      }),
    ).toBe("public/images");

    expect(
      pickAssetCreationTargetPath({
        isAstroProject: false,
        currentPath: ".vivd/uploads",
        fallbackGalleryPath: "images",
      }),
    ).toBe("images");
  });
});
