import type { CmsPreviewBinding } from "@/lib/cmsPreviewBindings";

export type ImageAssetScope =
  | "shared"
  | "entry"
  | "managed"
  | "public"
  | "working"
  | "legacy-static"
  | "external";

export type ImageDropChoiceKind = "copy-to-entry" | "use-existing";

export interface ImageDropChoice {
  kind: ImageDropChoiceKind;
  label: string;
  detail: string;
  primary?: boolean;
}

export type ImageDropPlanKind =
  | "set-cms-reference"
  | "copy-to-cms-entry"
  | "set-astro-source-image"
  | "set-static-html-src"
  | "import-working-asset"
  | "blocked";

export type ImageDropTargetContext =
  | {
      kind: "cms-asset-field";
      cmsBinding: CmsPreviewBinding;
      baselineSrc: string | null;
      astroSourceFile: string | null;
      astroSourceLoc: string | null;
    }
  | {
      kind: "astro-source-image";
      astroSourceFile: string;
      astroSourceLoc: string | null;
      baselineSrc: string | null;
      hasResponsiveMarkup: boolean;
    }
  | {
      kind: "static-html-image";
      baselineSrc: string | null;
      hasResponsiveMarkup: boolean;
    }
  | {
      kind: "unsupported-image";
      reason: string;
      baselineSrc: string | null;
    };

export type ImageDropWrite =
  | {
      type: "cms-field";
      mode: "reference" | "copy-to-entry";
      modelKey: string;
      entryKey: string;
      fieldPath: Array<string | number>;
      sourcePath: string;
    }
  | {
      type: "astro-source";
      mode: "content-import" | "copy-to-managed-import" | "public-runtime";
      sourceFile: string;
      sourceLoc: string | null;
      assetPath: string;
    }
  | {
      type: "static-html-src";
      assetPath: string;
    };

export interface ImageDropPlan {
  kind: ImageDropPlanKind;
  canDrop: boolean;
  assetPath: string | null;
  assetScope: ImageAssetScope | null;
  target: ImageDropTargetContext;
  label: string;
  detail: string;
  warnings: string[];
  requiresChoice: boolean;
  choices: ImageDropChoice[];
  writes: ImageDropWrite[];
  reason?: string;
}

const ASTRO_CONTENT_MEDIA_PATH = "src/content/media";
const ASTRO_SHARED_MEDIA_PATH = `${ASTRO_CONTENT_MEDIA_PATH}/shared`;

const EXTERNAL_REFERENCE_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function normalizeAssetPath(assetPath: string): string {
  return assetPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function basename(assetPath: string): string {
  const normalized = normalizeAssetPath(assetPath);
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function titleize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_/.]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isAstroManagedMediaPath(assetPath: string): boolean {
  const normalized = normalizeAssetPath(assetPath);
  return (
    normalized === ASTRO_CONTENT_MEDIA_PATH ||
    normalized.startsWith(`${ASTRO_CONTENT_MEDIA_PATH}/`)
  );
}

export function isAstroImportableImageAssetPath(assetPath: string): boolean {
  return isAstroManagedMediaPath(assetPath);
}

export function isPublicImageAssetPath(assetPath: string): boolean {
  const normalized = normalizeAssetPath(assetPath);
  return normalized === "public" || normalized.startsWith("public/");
}

function isWorkingAssetPath(assetPath: string): boolean {
  const normalized = normalizeAssetPath(assetPath);
  return normalized === ".vivd" || normalized.startsWith(".vivd/");
}

function isLegacyStaticAssetPath(assetPath: string): boolean {
  const normalized = normalizeAssetPath(assetPath);
  return (
    normalized === "images" ||
    normalized.startsWith("images/") ||
    normalized === "assets" ||
    normalized.startsWith("assets/")
  );
}

function getCmsEntryMediaPath(cmsBinding: CmsPreviewBinding): string {
  return `${ASTRO_CONTENT_MEDIA_PATH}/${cmsBinding.modelKey}/${cmsBinding.entryKey}`;
}

export function classifyImageAssetPath(
  assetPath: string,
  cmsBinding?: CmsPreviewBinding | null,
): ImageAssetScope {
  const normalized = normalizeAssetPath(assetPath);

  if (!normalized || EXTERNAL_REFERENCE_REGEX.test(normalized)) {
    return "external";
  }

  if (
    normalized === ASTRO_SHARED_MEDIA_PATH ||
    normalized.startsWith(`${ASTRO_SHARED_MEDIA_PATH}/`)
  ) {
    return "shared";
  }

  const mediaRelativePath = isAstroManagedMediaPath(normalized)
    ? normalized.slice(ASTRO_CONTENT_MEDIA_PATH.length).replace(/^\/+/, "")
    : "";
  const [mediaTopLevelSegment] = mediaRelativePath.split("/").filter(Boolean);
  if (mediaTopLevelSegment && /\.[a-z0-9]+$/i.test(mediaTopLevelSegment)) {
    return "shared";
  }

  if (cmsBinding) {
    const entryMediaPath = getCmsEntryMediaPath(cmsBinding);
    if (
      normalized === entryMediaPath ||
      normalized.startsWith(`${entryMediaPath}/`)
    ) {
      return "entry";
    }
  }

  if (isAstroManagedMediaPath(normalized)) {
    return "managed";
  }

  if (isPublicImageAssetPath(normalized)) {
    return "public";
  }

  if (isWorkingAssetPath(normalized)) {
    return "working";
  }

  if (isLegacyStaticAssetPath(normalized)) {
    return "legacy-static";
  }

  return "external";
}

function formatCmsTarget(cmsBinding: CmsPreviewBinding): string {
  const fieldName = cmsBinding.fieldPath.map((segment) => String(segment)).join(" / ");
  return `${titleize(cmsBinding.modelKey)} / ${titleize(cmsBinding.entryKey)} / ${titleize(fieldName)}`;
}

function formatCmsFieldName(cmsBinding: CmsPreviewBinding): string {
  const fieldName = cmsBinding.fieldPath.map((segment) => String(segment)).join(" / ");
  return titleize(fieldName);
}

function formatAssetScope(scope: ImageAssetScope | null): string {
  switch (scope) {
    case "shared":
      return "Shared media";
    case "entry":
      return "This entry";
    case "managed":
      return "Managed media";
    case "public":
      return "Public file";
    case "working":
      return "Working file";
    case "legacy-static":
      return "Static asset";
    default:
      return "Unsupported asset";
  }
}

function blockedPlan(
  target: ImageDropTargetContext,
  assetPath: string | null,
  assetScope: ImageAssetScope | null,
  reason: string,
): ImageDropPlan {
  return {
    kind: "blocked",
    canDrop: false,
    assetPath,
    assetScope,
    target,
    label: "This image cannot be replaced here",
    detail: reason,
    warnings: [],
    requiresChoice: false,
    choices: [],
    writes: [],
    reason,
  };
}

function copyToEntryChoice(): ImageDropChoice {
  return {
    kind: "copy-to-entry",
    label: "Make a copy for this entry",
    detail: "Only this CMS entry will use the copied image.",
    primary: true,
  };
}

function useExistingChoice(scope: ImageAssetScope): ImageDropChoice {
  return {
    kind: "use-existing",
    label: scope === "shared" ? "Use library image" : "Use existing image",
    detail:
      scope === "shared"
        ? "This entry will point to the shared library image."
        : "This entry will point to the image where it lives now.",
  };
}

function isLikelyEntryOwnedManagedMedia(
  assetPath: string,
  cmsBinding: CmsPreviewBinding,
): boolean {
  const normalized = normalizeAssetPath(assetPath);
  if (!isAstroManagedMediaPath(normalized)) {
    return false;
  }

  const mediaRelativePath = normalized
    .slice(ASTRO_CONTENT_MEDIA_PATH.length)
    .replace(/^\/+/, "");
  const segments = mediaRelativePath.split("/").filter(Boolean);
  if (segments.length < 3) {
    return false;
  }

  const [collection, entry] = segments;
  if (collection === "shared") {
    return false;
  }

  return collection !== cmsBinding.modelKey || entry !== cmsBinding.entryKey;
}

function cmsReferencePlan(
  target: Extract<ImageDropTargetContext, { kind: "cms-asset-field" }>,
  assetPath: string,
  assetScope: ImageAssetScope,
  options?: { requiresChoice?: boolean },
): ImageDropPlan {
  const fieldName = formatCmsFieldName(target.cmsBinding);
  const choices = options?.requiresChoice
    ? [copyToEntryChoice(), useExistingChoice(assetScope)]
    : [];

  return {
    kind: "set-cms-reference",
    canDrop: true,
    assetPath,
    assetScope,
    target,
    label: `Use this image for ${fieldName}`,
    detail:
      choices.length > 0
        ? "This image may belong to another entry. Choose whether to reuse it or make a copy."
        : "This entry will use the selected library image.",
    warnings:
      choices.length > 0
        ? ["Making a copy keeps future edits to this entry separate."]
        : [],
    requiresChoice: choices.length > 0,
    choices,
    writes: [
      {
        type: "cms-field",
        mode: "reference",
        modelKey: target.cmsBinding.modelKey,
        entryKey: target.cmsBinding.entryKey,
        fieldPath: target.cmsBinding.fieldPath,
        sourcePath: assetPath,
      },
    ],
  };
}

function cmsCopyPlan(
  target: Extract<ImageDropTargetContext, { kind: "cms-asset-field" }>,
  assetPath: string,
  assetScope: ImageAssetScope,
  kind: "copy-to-cms-entry" | "import-working-asset" = "copy-to-cms-entry",
): ImageDropPlan {
  const fieldName = formatCmsFieldName(target.cmsBinding);

  return {
    kind,
    canDrop: true,
    assetPath,
    assetScope,
    target,
    label: `Use this image for ${fieldName}`,
    detail: `${formatAssetScope(assetScope)} will be copied into this entry before the field is updated.`,
    warnings: [],
    requiresChoice: false,
    choices: [],
    writes: [
      {
        type: "cms-field",
        mode: "copy-to-entry",
        modelKey: target.cmsBinding.modelKey,
        entryKey: target.cmsBinding.entryKey,
        fieldPath: target.cmsBinding.fieldPath,
        sourcePath: assetPath,
      },
    ],
  };
}

export function resolveCmsDropMode(
  plan: ImageDropPlan,
  choice?: ImageDropChoiceKind | null,
): "reference" | "copy-to-entry" {
  if (choice === "copy-to-entry") return "copy-to-entry";
  if (choice === "use-existing") return "reference";
  if (plan.kind === "copy-to-cms-entry" || plan.kind === "import-working-asset") {
    return "copy-to-entry";
  }
  return "reference";
}

export function computeImageDropPlan(options: {
  assetPath?: string | null;
  target: ImageDropTargetContext;
}): ImageDropPlan {
  const { target } = options;
  const assetPath = options.assetPath ? normalizeAssetPath(options.assetPath) : null;
  const assetScope =
    assetPath && target.kind === "cms-asset-field"
      ? classifyImageAssetPath(assetPath, target.cmsBinding)
      : assetPath
        ? classifyImageAssetPath(assetPath)
        : null;

  if (target.kind === "unsupported-image") {
    return blockedPlan(target, assetPath, assetScope, target.reason);
  }

  if (!assetPath) {
    return {
      kind:
        target.kind === "cms-asset-field"
          ? "set-cms-reference"
          : target.kind === "astro-source-image"
            ? "set-astro-source-image"
            : "set-static-html-src",
      canDrop: true,
      assetPath: null,
      assetScope: null,
      target,
      label:
        target.kind === "cms-asset-field"
          ? `Drop to update ${formatCmsTarget(target.cmsBinding)}`
          : "Drop to replace this image",
      detail: "Release the image here to preview the replacement.",
      warnings: [],
      requiresChoice: false,
      choices: [],
      writes: [],
    };
  }

  if (target.kind === "cms-asset-field") {
    if (assetScope === "external") {
      return blockedPlan(
        target,
        assetPath,
        assetScope,
        "CMS image drops need a local managed, public, static, or working asset.",
      );
    }

    if (assetScope === "entry") {
      return cmsReferencePlan(target, assetPath, assetScope);
    }

    if (assetScope === "shared" || assetScope === "managed") {
      if (
        assetScope === "managed" &&
        isLikelyEntryOwnedManagedMedia(assetPath, target.cmsBinding)
      ) {
        return cmsReferencePlan(target, assetPath, assetScope, {
          requiresChoice: true,
        });
      }

      return cmsReferencePlan(target, assetPath, assetScope, {
        requiresChoice: false,
      });
    }

    if (assetScope === "working") {
      return cmsCopyPlan(target, assetPath, assetScope, "import-working-asset");
    }

    if (assetScope === "public" || assetScope === "legacy-static") {
      return cmsCopyPlan(target, assetPath, assetScope);
    }

    return blockedPlan(
      target,
      assetPath,
      assetScope,
      "CMS image drops need a local managed, public, static, or working asset.",
    );
  }

  if (target.kind === "astro-source-image") {
    if (assetScope && ["shared", "entry", "managed"].includes(assetScope)) {
      return {
        kind: "set-astro-source-image",
        canDrop: true,
        assetPath,
        assetScope,
        target,
        label: `Replace source image with ${basename(assetPath)}`,
        detail: `${formatAssetScope(assetScope)} will be imported from Astro source.`,
        warnings: [],
        requiresChoice: false,
        choices: [],
        writes: [
          {
            type: "astro-source",
            mode: "content-import",
            sourceFile: target.astroSourceFile,
            sourceLoc: target.astroSourceLoc,
            assetPath,
          },
        ],
      };
    }

    if (assetScope === "public" || assetScope === "legacy-static") {
      return {
        kind: "set-astro-source-image",
        canDrop: true,
        assetPath,
        assetScope,
        target,
        label: `Replace source image with ${basename(assetPath)}`,
        detail: `${formatAssetScope(assetScope)} will be copied into Shared media before the Astro source is updated.`,
        warnings: [],
        requiresChoice: false,
        choices: [],
        writes: [
          {
            type: "astro-source",
            mode: "copy-to-managed-import",
            sourceFile: target.astroSourceFile,
            sourceLoc: target.astroSourceLoc,
            assetPath,
          },
        ],
      };
    }

    return blockedPlan(
      target,
      assetPath,
      assetScope,
      "Astro preview drops only support local image assets under src/content/media/**, public/**, images/**, or assets/**.",
    );
  }

  if (target.hasResponsiveMarkup) {
    return blockedPlan(
      target,
      assetPath,
      assetScope,
      "Responsive picture/srcset images cannot be replaced directly from the static preview yet.",
    );
  }

  if (!target.baselineSrc) {
    return blockedPlan(
      target,
      assetPath,
      assetScope,
      "This image does not expose a stable src value, so Vivd cannot save the preview drop safely.",
    );
  }

  if (assetScope === "external") {
    return blockedPlan(
      target,
      assetPath,
      assetScope,
      "Static preview drops need a local project asset.",
    );
  }

  return {
    kind: "set-static-html-src",
    canDrop: true,
    assetPath,
    assetScope,
    target,
    label: `Update image source to ${basename(assetPath)}`,
    detail: `${formatAssetScope(assetScope)}: ${assetPath}`,
    warnings: [],
    requiresChoice: false,
    choices: [],
    writes: [
      {
        type: "static-html-src",
        assetPath,
      },
    ],
  };
}
