import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { resolveStudioRuntimePath } from "@/lib/studioAuth";
import { useImageDropZone } from "./useImageDropZone";
import { type PreviewMode } from "./types";
import { toAstroRuntimeAssetPath } from "./assetPathMapping";
import {
  getPreviewImageDropSupport,
} from "./imageDropHeuristics";
import {
  resolveCmsDropMode,
  type ImageDropChoiceKind,
  type ImageDropPlan,
} from "./imageDropPlan";
import {
  collectVivdTextPatchesFromDocument,
  getI18nKeyForEditableElement,
  type VivdPatch,
} from "@/lib/vivdPreviewTextPatching";
import {
  CMS_BINDING_SELECTOR,
  copyCmsBindingAttributes,
  type CmsPreviewFieldUpdate,
} from "@/lib/cmsPreviewBindings";

type SavePatch =
  | VivdPatch
  | {
      type: "setAstroImage";
      sourceFile: string;
      sourceLoc?: string;
      assetPath: string;
      oldValue?: string;
    }
  | { type: "setAttr"; selector: string; name: "src"; value: string };

type ImagePatch =
  | Extract<SavePatch, { type: "setAttr" }>
  | Extract<SavePatch, { type: "setAstroText" }>
  | Extract<SavePatch, { type: "setAstroImage" }>
  | Extract<SavePatch, { type: "setCmsField" }>;

interface UsePreviewInlineEditingOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  projectSlug?: string;
  selectedVersion: number;
  previewMode: PreviewMode;
  beginIframeLoading: () => void;
  refreshPreview: () => void;
}

export interface PendingImageDropChoiceRequest {
  plan: ImageDropPlan;
}

function toHtmlElement(target: EventTarget | Node | null): HTMLElement | null {
  if (!target || typeof target !== "object") {
    return null;
  }

  const node = target as Node;
  if (node.nodeType === 1) {
    return node as HTMLElement;
  }

  return node.parentElement as HTMLElement | null;
}

export function usePreviewInlineEditing({
  iframeRef,
  projectSlug,
  selectedVersion,
  previewMode,
  beginIframeLoading,
  refreshPreview,
}: UsePreviewInlineEditingOptions) {
  const utils = trpc.useUtils();
  const [editMode, setEditMode] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [imageDropChoiceRequest, setImageDropChoiceRequest] =
    useState<PendingImageDropChoiceRequest | null>(null);

  const pendingImagePatchesRef = useRef<Map<string, ImagePatch>>(new Map());
  const baselineSrcRef = useRef<Map<string, string | null>>(new Map());
  const editModeCleanupRef = useRef<(() => void) | null>(null);
  const imageDropChoiceResolverRef = useRef<
    ((choice: ImageDropChoiceKind | null) => void) | null
  >(null);

  const syncUnsavedChangesState = useCallback(() => {
    setHasUnsavedChanges(pendingImagePatchesRef.current.size > 0);
  }, []);

  const clearPendingPatches = useCallback(() => {
    pendingImagePatchesRef.current.clear();
    baselineSrcRef.current.clear();
    syncUnsavedChangesState();
  }, [syncUnsavedChangesState]);

  const cleanupEditModeListeners = useCallback(() => {
    editModeCleanupRef.current?.();
    editModeCleanupRef.current = null;
  }, []);

  const requestImageDropChoice = useCallback((plan: ImageDropPlan) => {
    imageDropChoiceResolverRef.current?.(null);

    return new Promise<ImageDropChoiceKind | null>((resolve) => {
      imageDropChoiceResolverRef.current = resolve;
      setImageDropChoiceRequest({ plan });
    });
  }, []);

  const resolveImageDropChoice = useCallback(
    (choice: ImageDropChoiceKind | null) => {
      imageDropChoiceResolverRef.current?.(choice);
      imageDropChoiceResolverRef.current = null;
      setImageDropChoiceRequest(null);
    },
    [],
  );

  useEffect(() => {
    return () => {
      imageDropChoiceResolverRef.current?.(null);
      imageDropChoiceResolverRef.current = null;
    };
  }, []);

  const getEditableTarget = useCallback((target: EventTarget | null) => {
    const start = toHtmlElement(target);
    if (!start) return null;
    if (start.isContentEditable) return start;
    const closest = start.closest?.('[contenteditable="true"]');
    return closest ? (closest as HTMLElement) : null;
  }, []);

  const getVivdSelector = useCallback((el: Element, doc: Document) => {
    const elementId = (el as HTMLElement).id;
    if (elementId) {
      return `//*[@id="${elementId}"]`;
    }

    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== doc.body) {
      const parentElement: HTMLElement | null = current.parentElement;
      if (!parentElement) break;

      const currentTagName = current.tagName;
      const tagName = currentTagName.toLowerCase();
      const siblings = Array.from(parentElement.children).filter(
        (sibling: Element) => sibling.tagName === currentTagName,
      );

      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tagName}[${index}]`);
      } else {
        parts.unshift(tagName);
      }

      current = parentElement;
    }

    if (!parts.length) return null;
    return `/${parts.join("/")}`;
  }, []);

  const getElementSelector = useCallback(
    (el: Element, doc: Document) => {
      const stored = el.getAttribute?.("data-vivd-selector");
      if (stored) return stored;

      const selector = getVivdSelector(el, doc);
      if (selector) {
        (el as HTMLElement).setAttribute?.("data-vivd-selector", selector);
      }
      return selector;
    },
    [getVivdSelector],
  );

  const normalizeAstroSourceFile = useCallback((astroSourceFile: string) => {
    const srcMatch = astroSourceFile.match(/\/(src\/.*\.astro)$/i);
    return srcMatch ? srcMatch[1] : astroSourceFile;
  }, []);

  const getOriginalAssetUrlFromPreviewUrl = useCallback(
    (src: string | null) => {
      if (!src) return null;

      let normalized = src;
      if (
        normalized.startsWith("http://") ||
        normalized.startsWith("https://")
      ) {
        try {
          normalized = new URL(normalized).pathname;
        } catch {
          // ignore malformed preview URLs
        }
      }

      if (!projectSlug) return normalized;

      const prefixes = [
        resolveStudioRuntimePath(
          `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}`,
        ),
        resolveStudioRuntimePath(
          `/vivd-studio/api/projects/${projectSlug}/v${selectedVersion}`,
        ),
      ];

      for (const prefix of prefixes) {
        if (normalized.startsWith(`${prefix}/`)) {
          return normalized.slice(prefix.length);
        }
      }

      return normalized;
    },
    [projectSlug, selectedVersion],
  );

  const collectTextPatchesFromDocument = useCallback((doc: Document) => {
    return collectVivdTextPatchesFromDocument(doc);
  }, []);

  const isCmsPreviewFieldUpdate = useCallback(
    (patch: SavePatch): patch is CmsPreviewFieldUpdate =>
      patch.type === "setCmsField",
    [],
  );

  const getImageDropSupport = useCallback(
    (targetImg: HTMLImageElement, assetPath?: string | null) =>
      getPreviewImageDropSupport({
        targetImg,
        previewMode,
        assetPath,
      }),
    [previewMode],
  );

  useImageDropZone({
    iframeRef,
    projectSlug,
    version: selectedVersion,
    enabled: !!projectSlug && !editMode,
    getDropSupport: getImageDropSupport,
    requestDropChoice: requestImageDropChoice,
    onImageDropped: (assetPath, targetImg, previousSrcAttr, dropOptions) => {
      if (!iframeRef.current?.contentDocument) return false;
      const dropSupport = getImageDropSupport(targetImg, assetPath);
      if (!dropSupport.canDrop || !dropSupport.strategy) {
        if (previousSrcAttr) {
          targetImg.setAttribute("src", previousSrcAttr);
        } else {
          targetImg.removeAttribute("src");
        }
        toast.error(
          dropSupport.reason ??
            "Vivd can't save this preview image drop safely yet.",
        );
        return false;
      }

      if (dropSupport.strategy === "cms" && dropSupport.cmsBinding) {
        const cmsBinding = dropSupport.cmsBinding;
        const key = `cms:${cmsBinding.modelKey}:${cmsBinding.entryKey}:${cmsBinding.fieldPath.join(".")}`;
        const dropMode = dropOptions?.plan
          ? resolveCmsDropMode(dropOptions.plan, dropOptions.choice)
          : "reference";
        pendingImagePatchesRef.current.set(key, {
          type: "setCmsField",
          modelKey: cmsBinding.modelKey,
          entryKey: cmsBinding.entryKey,
          fieldPath: cmsBinding.fieldPath,
          value: assetPath,
          assetAction:
            dropMode === "copy-to-entry"
              ? {
                  kind: "copy-to-entry",
                  sourcePath: assetPath,
                }
              : undefined,
        });
        syncUnsavedChangesState();
        return;
      }

      const doc = iframeRef.current.contentDocument;
      const selector = getElementSelector(targetImg, doc);
      if (!selector) return;

      const key = `setAttr:${selector}:src`;
      if (!baselineSrcRef.current.has(key)) {
        baselineSrcRef.current.set(
          key,
          getOriginalAssetUrlFromPreviewUrl(
            previousSrcAttr ?? dropSupport.baselineSrc,
          ),
        );
      }

      const baseline = baselineSrcRef.current.get(key) ?? null;
      if (
        dropSupport.strategy === "astro-import" ||
        dropSupport.strategy === "astro-public"
      ) {
        if (!dropSupport.astroSourceFile) {
          toast.error(
            "Vivd couldn't resolve the Astro source file for this preview image drop.",
          );
          return false;
        }

        const sourceFile = normalizeAstroSourceFile(dropSupport.astroSourceFile);
        if (dropSupport.strategy === "astro-import") {
          pendingImagePatchesRef.current.set(key, {
            type: "setAstroImage",
            sourceFile,
            sourceLoc: dropSupport.astroSourceLoc ?? undefined,
            assetPath: assetPath.replace(/\\/g, "/").replace(/^\/+/, ""),
            oldValue: baseline ?? undefined,
          });
          syncUnsavedChangesState();
          return;
        }
        if (!baseline) {
          toast.error(
            "This image doesn't have a source src value, so Vivd can't save the change for Astro projects.",
          );
          syncUnsavedChangesState();
          return false;
        }
        const newValue = toAstroRuntimeAssetPath(assetPath, baseline);
        if (!newValue) {
          if (previousSrcAttr) {
            targetImg.setAttribute("src", previousSrcAttr);
          } else {
            targetImg.removeAttribute("src");
          }
          toast.error(
            "Vivd can only save Astro preview drops directly for CMS-bound images or `public/` assets. Bind the image to CMS content or use a public asset URL.",
          );
          syncUnsavedChangesState();
          return false;
        }
        if (baseline === newValue) {
          pendingImagePatchesRef.current.delete(key);
        } else {
          pendingImagePatchesRef.current.set(key, {
            type: "setAstroText",
            sourceFile,
            sourceLoc: dropSupport.astroSourceLoc ?? undefined,
            oldValue: baseline,
            newValue,
          });
        }
        syncUnsavedChangesState();
        return;
      }

      if (baseline === assetPath) {
        pendingImagePatchesRef.current.delete(key);
      } else {
        pendingImagePatchesRef.current.set(key, {
          type: "setAttr",
          selector,
          name: "src",
          value: assetPath,
        });
      }
      syncUnsavedChangesState();
    },
  });

  const applyHtmlPatchesMutation = trpc.project.applyHtmlPatches.useMutation();
  const applyCmsPreviewFieldUpdatesMutation =
    trpc.cms.applyPreviewFieldUpdates.useMutation();
  const isSaving =
    applyHtmlPatchesMutation.isPending ||
    applyCmsPreviewFieldUpdatesMutation.isPending;

  const handleCancelEdit = useCallback(() => {
    setEditMode(false);
    clearPendingPatches();
    cleanupEditModeListeners();
    toast.info("Changes discarded");
    beginIframeLoading();
    refreshPreview();
  }, [
    beginIframeLoading,
    cleanupEditModeListeners,
    clearPendingPatches,
    refreshPreview,
  ]);

  const toggleEditMode = useCallback(() => {
    if (editMode) {
      handleCancelEdit();
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;

    const doc = iframe.contentDocument;
    setEditMode(true);
    cleanupEditModeListeners();

    const style = doc.createElement("style");
    style.id = "edit-mode-styles";
    style.textContent = `
        [contenteditable="true"] {
          outline: 2px dashed #3b82f6 !important;
          cursor: text !important;
        }
        [contenteditable="true"]:hover {
          outline: 2px solid #2563eb !important;
          background-color: rgba(59, 130, 246, 0.1);
        }
        [contenteditable="true"]:focus {
          outline: 2px solid #2563eb !important;
          background-color: rgba(59, 130, 246, 0.05);
        }
        [data-vivd-editable-container="true"] {
          cursor: text !important;
        }
        [data-vivd-editable-container="true"]:hover {
          outline: 2px dashed #3b82f6 !important;
          background-color: rgba(59, 130, 246, 0.06);
        }
        [data-vivd-editable-container="true"]:focus-within {
          outline: 2px solid #2563eb !important;
          background-color: rgba(59, 130, 246, 0.04);
        }
    `;
    doc.head.appendChild(style);

    const allBodyElements = Array.from(doc.body.querySelectorAll("*"));
    allBodyElements.forEach((el) => {
      getElementSelector(el, doc);
    });

    const SKIP_TAGS = new Set([
      "script",
      "style",
      "noscript",
      "svg",
      "select",
      "option",
      "textarea",
    ]);

    const makeEditable = (element: Element) => {
      const el = element as HTMLElement;
      if (!el || el.isContentEditable) return;
      if (SKIP_TAGS.has(el.tagName.toLowerCase())) return;
      if (el.closest?.("svg")) return;

      const selector = getElementSelector(el, doc);
      if (!selector) return;
      const i18nKey = getI18nKeyForEditableElement(el);

      const astroSourceEl = el.closest(
        "[data-astro-source-file]",
      ) as HTMLElement | null;
      const astroSourceFile =
        astroSourceEl?.getAttribute("data-astro-source-file") ?? null;
      const astroSourceLoc =
        astroSourceEl?.getAttribute("data-astro-source-loc") ?? null;

      const directTextNodes = Array.from(el.childNodes).filter(
        (node): node is Text =>
          node.nodeType === Node.TEXT_NODE &&
          typeof node.nodeValue === "string" &&
          node.nodeValue.trim().length > 0,
      );

      if (!directTextNodes.length) return;
      el.setAttribute("data-vivd-editable-container", "true");
      const cmsBindingSource =
        directTextNodes.length === 1 && el.children.length === 0
          ? (el.closest(CMS_BINDING_SELECTOR) as HTMLElement | null)
          : null;

      directTextNodes.forEach((node, idx) => {
        const index = idx + 1;
        const original = node.nodeValue ?? "";
        const match = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const prefix = match?.[1] ?? "";
        const suffix = match?.[3] ?? "";
        const coreText = original.slice(
          prefix.length,
          original.length - suffix.length,
        );

        const fragment = doc.createDocumentFragment();
        if (prefix) fragment.appendChild(doc.createTextNode(prefix));

        const span = doc.createElement("span");
        span.setAttribute("data-vivd-text-parent-selector", selector);
        span.setAttribute("data-vivd-text-node-index", String(index));
        span.setAttribute("data-vivd-text-baseline", coreText);
        if (i18nKey) span.setAttribute("data-vivd-i18n-key", i18nKey);
        if (cmsBindingSource) {
          copyCmsBindingAttributes(cmsBindingSource, span);
        }

        if (astroSourceFile) {
          const srcMatch = astroSourceFile.match(/\/(src\/.*\.astro)$/i);
          span.setAttribute(
            "data-vivd-source-file",
            srcMatch ? srcMatch[1] : astroSourceFile,
          );
          if (astroSourceLoc) {
            span.setAttribute("data-vivd-source-loc", astroSourceLoc);
          }
        }

        span.setAttribute("contenteditable", "true");
        span.textContent = coreText;
        span.addEventListener("click", (event) => event.stopPropagation());
        span.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
          }
        });

        fragment.appendChild(span);
        if (suffix) fragment.appendChild(doc.createTextNode(suffix));

        node.parentNode?.replaceChild(fragment, node);
      });
    };

    allBodyElements.forEach(makeEditable);

    doc.querySelectorAll("a").forEach((linkElement) => {
      const link = linkElement as HTMLAnchorElement;
      link.setAttribute("data-href-backup", link.getAttribute("href") || "");
      link.removeAttribute("href");
      link.style.cursor = "text";
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = getEditableTarget(event.target);
      if (!target) return;

      if (event.key === "Enter") {
        event.preventDefault();
      }
    };

    const handlePaste = (event: ClipboardEvent) => {
      const target = getEditableTarget(event.target);
      if (!target) return;

      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      doc.execCommand("insertText", false, text);
    };

    const handleClick = (event: MouseEvent) => {
      if (getEditableTarget(event.target)) return;

      const start = toHtmlElement(event.target);
      if (!start) return;

      const container = start.closest?.(
        '[data-vivd-editable-container="true"]',
      );
      const clickable = start.closest?.("[onclick], [role='link']");

      const focusRoot =
        (container ? (container as HTMLElement) : null) ??
        (clickable ? (clickable as HTMLElement) : null);
      if (!focusRoot) return;

      const firstEditable =
        focusRoot.querySelector<HTMLElement>('[contenteditable="true"]') ?? null;
      if (!firstEditable) return;
      event.preventDefault();
      event.stopPropagation();
      firstEditable.focus();
    };

    doc.addEventListener("keydown", handleKeyDown, true);
    doc.addEventListener("paste", handlePaste, true);
    doc.addEventListener("click", handleClick, true);

    editModeCleanupRef.current = () => {
      doc.removeEventListener("keydown", handleKeyDown, true);
      doc.removeEventListener("paste", handlePaste, true);
      doc.removeEventListener("click", handleClick, true);
    };

    toast.info("Edit Mode Enabled: Click text to edit");
  }, [
    cleanupEditModeListeners,
    editMode,
    getEditableTarget,
    getElementSelector,
    handleCancelEdit,
    iframeRef,
  ]);

  const handleSave = useCallback(() => {
    if (!projectSlug || isSaving) return;

    const getActiveHtmlFilePath = (): string => {
      if (previewMode !== "static") return "index.html";

      const iframe = iframeRef.current;
      const win = iframe?.contentWindow ?? null;
      let pathname = "";
      try {
        pathname = win?.location?.pathname ?? "";
      } catch {
        return "index.html";
      }
      if (!pathname) return "index.html";

      const bases = [
        resolveStudioRuntimePath(
          `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}`,
        ),
        resolveStudioRuntimePath(
          `/vivd-studio/api/projects/${projectSlug}/v${selectedVersion}`,
        ),
      ];

      let relative = pathname;
      for (const base of bases) {
        if (relative === base || relative.startsWith(`${base}/`)) {
          relative = relative.slice(base.length);
          break;
        }
      }

      relative = relative.replace(/^\/+/, "");
      if (!relative) return "index.html";

      try {
        relative = decodeURIComponent(relative);
      } catch {
        // ignore malformed preview paths
      }

      if (relative.endsWith("/")) {
        relative = `${relative}index.html`;
      }

      if (!/\.[a-z0-9]+$/i.test(relative)) {
        relative = `${relative}.html`;
      }

      if (!/\.html?$/i.test(relative)) return "index.html";

      return relative;
    };

    const finishSuccessfulSave = () => {
      setEditMode(false);
      clearPendingPatches();
      cleanupEditModeListeners();
      beginIframeLoading();
      refreshPreview();
      void utils.assets.invalidate();
      void utils.project.gitHasChanges.invalidate();
      void utils.cms.status.invalidate();
    };

    void (async () => {
      const iframeDoc = iframeRef.current?.contentDocument ?? null;
      const textPatches = iframeDoc
        ? collectTextPatchesFromDocument(iframeDoc)
        : [];
      const imagePatches = Array.from(pendingImagePatchesRef.current.values());
      const allChanges: SavePatch[] = [...imagePatches, ...textPatches];

      if (!allChanges.length) {
        toast.info("No changes to save");
        setEditMode(false);
        clearPendingPatches();
        cleanupEditModeListeners();
        beginIframeLoading();
        refreshPreview();
        return;
      }

      const cmsFieldUpdates = allChanges.filter(isCmsPreviewFieldUpdate);
      const rawPatches = allChanges.filter(
        (patch): patch is Exclude<SavePatch, CmsPreviewFieldUpdate> =>
          patch.type !== "setCmsField",
      );

      let cmsApplied = 0;
      let cmsValidationError: string | null = null;

      try {
        if (cmsFieldUpdates.length > 0) {
          const cmsResult = await applyCmsPreviewFieldUpdatesMutation.mutateAsync({
            slug: projectSlug,
            version: selectedVersion,
            updates: cmsFieldUpdates.map((update) => ({
              modelKey: update.modelKey,
              entryKey: update.entryKey,
              fieldPath: update.fieldPath,
              value: update.value,
              assetAction: update.assetAction,
            })),
          });
          cmsApplied = cmsResult.updated.updated.length;
          cmsValidationError = cmsResult.error;
        }

        let rawResult:
          | Awaited<ReturnType<typeof applyHtmlPatchesMutation.mutateAsync>>
          | null = null;
        if (rawPatches.length > 0) {
          rawResult = await applyHtmlPatchesMutation.mutateAsync({
            slug: projectSlug,
            version: selectedVersion,
            filePath: getActiveHtmlFilePath(),
            patches: rawPatches,
          });
        }

        const rawErrors = rawResult?.errors ?? [];
        const hasMissingElements = rawErrors.some(
          (error) => error.reason === "Element not found",
        );
        const hasAstroTextNotFound = rawErrors.some((error) =>
          error.reason.startsWith("Text not found:"),
        );
        const hasAstroAmbiguousText = rawErrors.some((error) =>
          error.reason.startsWith("Ambiguous text match:"),
        );
        const rawApplied = rawResult ? !rawResult.noChanges : false;
        const nothingChanged = cmsApplied === 0 && !rawApplied;

        if (nothingChanged) {
          if (rawErrors.length > 0) {
            toast.error(
              hasMissingElements ||
                hasAstroTextNotFound ||
                hasAstroAmbiguousText
                ? "We couldn't change this text here. Please ask the agent to update the source."
                : "We couldn't apply these changes here. Please ask the agent to update the source.",
            );
          } else {
            toast.info("No changes to save");
          }
          finishSuccessfulSave();
          return;
        }

        if (cmsValidationError) {
          toast.success(
            "Saved, but CMS validation reported follow-up issues. Open the CMS to review them.",
          );
        } else if (rawErrors.length > 0) {
          toast.success(
            hasMissingElements
              ? "Saved (some edited text is generated by JavaScript and can't be saved here — ask the agent to update it)"
              : hasAstroTextNotFound
                ? "Saved (some edited text is data-driven and can't be saved here — ask the agent to update it)"
                : hasAstroAmbiguousText
                  ? "Saved (some edited text appears multiple times and couldn't be matched safely — ask the agent to update it)"
                  : "Saved (some edits were skipped — ask the agent to update the missing ones)",
          );
        } else {
          toast.success("Changes saved successfully");
        }

        finishSuccessfulSave();
      } catch (error) {
        if (cmsApplied > 0) {
          toast.success(
            "Saved CMS-backed changes, but some fallback preview patches failed. Ask the agent to update the remaining source-owned content.",
          );
          finishSuccessfulSave();
          return;
        }
        toast.error(
          `Failed to save changes: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }, [
    applyCmsPreviewFieldUpdatesMutation,
    applyHtmlPatchesMutation,
    beginIframeLoading,
    cleanupEditModeListeners,
    clearPendingPatches,
    collectTextPatchesFromDocument,
    iframeRef,
    isCmsPreviewFieldUpdate,
    isSaving,
    previewMode,
    projectSlug,
    refreshPreview,
    selectedVersion,
    utils.assets,
    utils.cms.status,
    utils.project.gitHasChanges,
  ]);

  return {
    editMode,
    hasUnsavedChanges,
    isSaving,
    imageDropChoiceRequest,
    resolveImageDropChoice,
    toggleEditMode,
    handleSave,
    handleCancelEdit,
    clearPendingPatches,
  };
}
