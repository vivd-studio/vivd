import {
  readCmsBindingFromElement,
  type CmsPreviewBinding,
} from "@/lib/cmsPreviewBindings";
import { type PreviewMode } from "./types";
import {
  computeImageDropPlan,
  isAstroImportableImageAssetPath,
  isPublicImageAssetPath,
  type ImageDropPlan,
  type ImageDropTargetContext,
} from "./imageDropPlan";

const PROJECT_ASTRO_SOURCE_REGEX = /(?:^|\/)(src\/.*\.astro)$/i;

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
  plan: ImageDropPlan;
}

function normalizeAssetPath(assetPath: string): string {
  return assetPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isAstroImportableContentAssetPath(assetPath: string): boolean {
  return isAstroImportableImageAssetPath(assetPath);
}

export function isPublicAssetPath(assetPath: string): boolean {
  return isPublicImageAssetPath(assetPath);
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
  let current: Element | null = targetImg;
  while (current) {
    const sourceFile = current.getAttribute?.("data-astro-source-file");
    if (sourceFile && PROJECT_ASTRO_SOURCE_REGEX.test(sourceFile.replace(/\\/g, "/"))) {
      return {
        astroSourceFile: sourceFile,
        astroSourceLoc: current.getAttribute("data-astro-source-loc"),
      };
    }
    current = current.parentElement;
  }

  return {
    astroSourceFile: null,
    astroSourceLoc: null,
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
  let target: ImageDropTargetContext;

  if (cmsBinding && (cmsBinding.kind === null || cmsBinding.kind === "asset")) {
    target = {
      kind: "cms-asset-field",
      cmsBinding,
      baselineSrc,
      astroSourceFile,
      astroSourceLoc,
    };
  } else if (previewMode === "devserver") {
    if (!astroSourceFile) {
      target = {
        kind: "unsupported-image",
        reason:
          "Dev-server preview drops only work on CMS-bound or source-backed Astro images.",
        baselineSrc,
      };
    } else if (!hasAstroAnchor) {
      target = {
        kind: "unsupported-image",
        reason:
          "This Astro image does not expose enough source information for a stable preview drop yet.",
        baselineSrc,
      };
    } else {
      target = {
        kind: "astro-source-image",
        astroSourceFile,
        astroSourceLoc,
        baselineSrc,
        hasResponsiveMarkup,
      };
    }
  } else {
    target = {
      kind: "static-html-image",
      baselineSrc,
      hasResponsiveMarkup,
    };
  }

  const plan = computeImageDropPlan({
    assetPath: assetPath ? normalizeAssetPath(assetPath) : null,
    target,
  });
  const astroSourceWrite = plan.writes.find(
    (write) => write.type === "astro-source",
  );
  const strategy: PreviewImageDropStrategy | null = !plan.canDrop
    ? null
    : plan.kind === "set-cms-reference" ||
        plan.kind === "copy-to-cms-entry" ||
        plan.kind === "import-working-asset"
      ? "cms"
      : plan.kind === "set-astro-source-image"
        ? astroSourceWrite?.type === "astro-source" &&
          astroSourceWrite.mode === "public-runtime"
          ? "astro-public"
          : "astro-import"
        : "static-html";

  return {
    canDrop: plan.canDrop,
    strategy,
    reason: plan.reason,
    baselineSrc,
    cmsBinding: target.kind === "cms-asset-field" ? target.cmsBinding : null,
    astroSourceFile,
    astroSourceLoc,
    plan,
  };
}
