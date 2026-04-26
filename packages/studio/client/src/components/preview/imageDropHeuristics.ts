import {
  readCmsBindingFromElement,
  type CmsPreviewBinding,
} from "@/lib/cmsPreviewBindings";
import { type PreviewMode } from "./types";

const ASTRO_SOURCE_SELECTOR = "[data-astro-source-file]";

export type PreviewImageDropStrategy =
  | "cms"
  | "astro-import"
  | "astro-public"
  | "static-html";

export interface PreviewImageDropSupport {
  canDrop: boolean;
  strategy: PreviewImageDropStrategy | null;
  reason?: string;
  baselineSrc: string | null;
  cmsBinding: CmsPreviewBinding | null;
  astroSourceFile: string | null;
  astroSourceLoc: string | null;
}

function normalizeAssetPath(assetPath: string): string {
  return assetPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isAstroImportableContentAssetPath(assetPath: string): boolean {
  const normalizedPath = normalizeAssetPath(assetPath);
  return (
    normalizedPath === "src/content" ||
    normalizedPath.startsWith("src/content/")
  );
}

export function isPublicAssetPath(assetPath: string): boolean {
  const normalizedPath = normalizeAssetPath(assetPath);
  return normalizedPath === "public" || normalizedPath.startsWith("public/");
}

export function getPreviewImageBaselineSource(
  targetImg: HTMLImageElement,
): string | null {
  for (const candidate of [
    targetImg.getAttribute("src"),
    targetImg.getAttribute("data-original-src"),
    targetImg.currentSrc,
  ]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

export function hasResponsivePreviewImageMarkup(
  targetImg: HTMLImageElement,
): boolean {
  const srcset = targetImg.getAttribute("srcset");
  if (typeof srcset === "string" && srcset.trim().length > 0) {
    return true;
  }

  const picture = targetImg.closest("picture");
  if (!picture) {
    return false;
  }

  return Array.from(picture.querySelectorAll("source")).some((source) => {
    const sourceSrcset = source.getAttribute("srcset");
    return typeof sourceSrcset === "string" && sourceSrcset.trim().length > 0;
  });
}

function readAstroSourceMeta(targetImg: HTMLImageElement): {
  astroSourceFile: string | null;
  astroSourceLoc: string | null;
} {
  const astroSourceEl = targetImg.closest(ASTRO_SOURCE_SELECTOR) as
    | HTMLElement
    | null;
  return {
    astroSourceFile:
      astroSourceEl?.getAttribute("data-astro-source-file") ?? null,
    astroSourceLoc:
      astroSourceEl?.getAttribute("data-astro-source-loc") ?? null,
  };
}

export function getPreviewImageDropSupport(options: {
  targetImg: HTMLImageElement;
  previewMode: PreviewMode;
  assetPath?: string | null;
}): PreviewImageDropSupport {
  const { targetImg, previewMode, assetPath } = options;
  const cmsBinding = readCmsBindingFromElement(targetImg);
  const baselineSrc = getPreviewImageBaselineSource(targetImg);
  const { astroSourceFile, astroSourceLoc } = readAstroSourceMeta(targetImg);
  const hasResponsiveMarkup = hasResponsivePreviewImageMarkup(targetImg);
  const hasAstroAnchor = Boolean(astroSourceLoc || baselineSrc);

  if (cmsBinding && (cmsBinding.kind === null || cmsBinding.kind === "asset")) {
    return {
      canDrop: true,
      strategy: "cms",
      baselineSrc,
      cmsBinding,
      astroSourceFile,
      astroSourceLoc,
    };
  }

  if (previewMode === "devserver") {
    if (!astroSourceFile) {
      return {
        canDrop: false,
        strategy: null,
        reason:
          "Dev-server preview drops only work on CMS-bound or source-backed Astro images.",
        baselineSrc,
        cmsBinding: null,
        astroSourceFile: null,
        astroSourceLoc: null,
      };
    }

    if (!hasAstroAnchor) {
      return {
        canDrop: false,
        strategy: null,
        reason:
          "This Astro image does not expose enough source information for a stable preview drop yet.",
        baselineSrc,
        cmsBinding: null,
        astroSourceFile,
        astroSourceLoc,
      };
    }

    if (!assetPath) {
      return {
        canDrop: true,
        strategy: "astro-import",
        baselineSrc,
        cmsBinding: null,
        astroSourceFile,
        astroSourceLoc,
      };
    }

    if (isAstroImportableContentAssetPath(assetPath)) {
      return {
        canDrop: true,
        strategy: "astro-import",
        baselineSrc,
        cmsBinding: null,
        astroSourceFile,
        astroSourceLoc,
      };
    }

    if (!isPublicAssetPath(assetPath)) {
      return {
        canDrop: false,
        strategy: null,
        reason:
          "Astro preview drops only support local image assets under `src/content/**` or files under `public/`.",
        baselineSrc,
        cmsBinding: null,
        astroSourceFile,
        astroSourceLoc,
      };
    }

    if (!baselineSrc) {
      return {
        canDrop: false,
        strategy: null,
        reason:
          "This Astro image does not expose a stable src value, so Vivd can't rewrite it safely from preview.",
        baselineSrc,
        cmsBinding: null,
        astroSourceFile,
        astroSourceLoc,
      };
    }

    if (hasResponsiveMarkup) {
      return {
        canDrop: false,
        strategy: null,
        reason:
          "Responsive Astro images can only be preview-dropped with local `src/content/**` assets right now.",
        baselineSrc,
        cmsBinding: null,
        astroSourceFile,
        astroSourceLoc,
      };
    }

    return {
      canDrop: true,
      strategy: "astro-public",
      baselineSrc,
      cmsBinding: null,
      astroSourceFile,
      astroSourceLoc,
    };
  }

  if (hasResponsiveMarkup) {
    return {
      canDrop: false,
      strategy: null,
      reason:
        "Responsive `picture`/`srcset` images can't be replaced directly from the static preview yet.",
      baselineSrc,
      cmsBinding: null,
      astroSourceFile,
      astroSourceLoc,
    };
  }

  if (!baselineSrc) {
    return {
      canDrop: false,
      strategy: null,
      reason:
        "This image does not expose a stable src value, so Vivd can't save the preview drop safely.",
      baselineSrc,
      cmsBinding: null,
      astroSourceFile,
      astroSourceLoc,
    };
  }

  return {
    canDrop: true,
    strategy: "static-html",
    baselineSrc,
    cmsBinding: null,
    astroSourceFile,
    astroSourceLoc,
  };
}
