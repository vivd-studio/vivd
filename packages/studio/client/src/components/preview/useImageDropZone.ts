import { useEffect, useCallback, type RefObject } from "react";
import { toast } from "sonner";
import { getVivdStudioToken, withVivdStudioTokenQuery } from "@/lib/studioAuth";
import { getPreviewImageBaselineSource } from "./imageDropHeuristics";
import type {
  ImageDropChoiceKind,
  ImageDropPlan,
} from "./imageDropPlan";

interface UseImageDropZoneOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  projectSlug?: string;
  version?: number;
  enabled?: boolean;
  getDropSupport?: (
    targetImg: HTMLImageElement,
    assetPath?: string | null,
  ) => { canDrop: boolean; reason?: string; plan?: ImageDropPlan };
  requestDropChoice?: (
    plan: ImageDropPlan,
  ) => Promise<ImageDropChoiceKind | null>;
  onImageDropped?: (
    imagePath: string,
    targetImg: HTMLImageElement,
    previousSrcAttr: string | null,
    options?: {
      plan?: ImageDropPlan;
      choice?: ImageDropChoiceKind | null;
    },
  ) => void | boolean | Promise<void | boolean>;
}

// CSS styles for drop zone highlighting
const DROP_ZONE_STYLES = `
  @keyframes dropzone-pulse-border {
    0%, 100% { border-color: #22c55e; filter: brightness(1.1); }
    50% { border-color: #16a34a; filter: brightness(1.2); }
  }
  
  @keyframes dropzone-ready-border {
    0%, 100% { border-color: #f59e0b; }
    50% { border-color: #fbbf24; }
  }

  @keyframes dropzone-blocked-border {
    0%, 100% { border-color: #ef4444; }
    50% { border-color: #f87171; }
  }
  
  /* During drag mode, disable pointer-events on overlay elements */
  .drag-mode-active *:not(img):not([data-drop-target]) {
    pointer-events: none !important;
  }
  
  /* Re-enable pointer events on images and drop targets */
  .drag-mode-active img,
  .drag-mode-active [data-drop-target] {
    pointer-events: auto !important;
  }
  
  /* Base state: Image is a valid drop target */
  [data-drop-target="true"] {
    border: 4px solid #f59e0b !important;
    box-sizing: border-box !important;
    animation: dropzone-ready-border 1s ease-in-out infinite !important;
    filter: brightness(1.05) !important;
    position: relative;
    z-index: 9999 !important;
    cursor: copy !important;
  }

  [data-drop-target="blocked"] {
    border: 4px solid #ef4444 !important;
    box-sizing: border-box !important;
    animation: dropzone-blocked-border 1s ease-in-out infinite !important;
    filter: brightness(0.92) !important;
    position: relative;
    z-index: 9999 !important;
    cursor: not-allowed !important;
  }
  
  /* Hover state: About to drop */
  [data-drop-target="active"] {
    border: 5px solid #22c55e !important;
    box-sizing: border-box !important;
    animation: dropzone-pulse-border 0.6s ease-in-out infinite !important;
    filter: brightness(1.15) !important;
    cursor: copy !important;
    z-index: 10000 !important;
  }

  .vivd-image-drop-hint {
    position: fixed;
    z-index: 2147483647;
    max-width: min(340px, calc(100vw - 24px));
    pointer-events: none;
    border: 1px solid rgba(15, 23, 42, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.96);
    color: #0f172a;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
    padding: 8px 10px;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.3;
  }

  .vivd-image-drop-hint[data-tone="blocked"] {
    border-color: rgba(220, 38, 38, 0.32);
  }

  .vivd-image-drop-hint-title {
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .vivd-image-drop-hint-detail {
    margin-top: 2px;
    font-size: 11px;
    color: #475569;
    overflow-wrap: anywhere;
  }
`;

function getDropHintElement(doc: Document): HTMLDivElement {
  const existing = doc.getElementById("vivd-image-drop-hint");
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const hint = doc.createElement("div");
  hint.id = "vivd-image-drop-hint";
  hint.className = "vivd-image-drop-hint";
  hint.hidden = true;
  hint.innerHTML = `
    <div class="vivd-image-drop-hint-title"></div>
    <div class="vivd-image-drop-hint-detail"></div>
  `;
  doc.body.appendChild(hint);
  return hint;
}

function positionDropHint(hint: HTMLDivElement, img: HTMLImageElement) {
  const rect = img.getBoundingClientRect();
  const viewportWidth = img.ownerDocument.defaultView?.innerWidth ?? 0;
  const left = Math.min(
    Math.max(rect.left + 8, 8),
    Math.max(viewportWidth - 348, 8),
  );
  const top = Math.max(rect.top + 8, 8);
  hint.style.left = `${left}px`;
  hint.style.top = `${top}px`;
}

function showDropHint(
  doc: Document,
  img: HTMLImageElement,
  support: { canDrop: boolean; reason?: string; plan?: ImageDropPlan },
) {
  const hint = getDropHintElement(doc);
  const title = hint.querySelector<HTMLDivElement>(".vivd-image-drop-hint-title");
  const detail = hint.querySelector<HTMLDivElement>(".vivd-image-drop-hint-detail");
  hint.dataset.tone = support.canDrop ? "ready" : "blocked";
  if (title) {
    title.textContent = support.plan?.label ?? "Drop image here";
  }
  if (detail) {
    detail.textContent =
      support.plan?.detail ??
      support.reason ??
      "Release to preview this replacement.";
  }
  positionDropHint(hint, img);
  hint.hidden = false;
}

function hideDropHint(doc: Document) {
  const hint = doc.getElementById("vivd-image-drop-hint");
  if (hint instanceof HTMLDivElement) {
    hint.hidden = true;
  }
}

type DropZoneImage = HTMLImageElement & {
  _vivdImageDropHandlers?: {
    dragover: (event: DragEvent) => void;
    dragleave: (event: DragEvent) => void;
    drop: (event: DragEvent) => void;
  };
};

type DropZoneDocument = Document & {
  _vivdImageDropDocumentHandlers?: {
    dragend: (event: DragEvent) => void;
    drop: (event: DragEvent) => void;
  };
};

function removeImageDropHandlers(img: HTMLImageElement) {
  const dropImage = img as DropZoneImage;
  const handlers = dropImage._vivdImageDropHandlers;
  if (!handlers) {
    return;
  }

  img.removeEventListener("dragover", handlers.dragover);
  img.removeEventListener("dragleave", handlers.dragleave);
  img.removeEventListener("drop", handlers.drop);
  delete dropImage._vivdImageDropHandlers;
}

function cleanupDropZoneDocument(doc: Document) {
  doc.getElementById("image-drop-zone-styles")?.remove();
  hideDropHint(doc);
  doc.getElementById("vivd-image-drop-hint")?.remove();
  doc.body?.classList.remove("drag-mode-active");

  const dropDoc = doc as DropZoneDocument;
  const documentHandlers = dropDoc._vivdImageDropDocumentHandlers;
  if (documentHandlers) {
    doc.removeEventListener("dragend", documentHandlers.dragend);
    doc.removeEventListener("drop", documentHandlers.drop);
    delete dropDoc._vivdImageDropDocumentHandlers;
  }

  doc.querySelectorAll("img").forEach((img) => {
    img.removeAttribute("data-drop-target");
    removeImageDropHandlers(img);
  });
}

/**
 * Hook that enables drag-and-drop of images onto <img> elements inside an iframe.
 * Automatically activates drop zones when a drag operation starts.
 */
export function useImageDropZone({
  iframeRef,
  projectSlug,
  version,
  enabled = true,
  getDropSupport,
  requestDropChoice,
  onImageDropped,
}: UseImageDropZoneOptions) {
  // Build the image URL for preview display
  const buildImagePreviewUrl = useCallback((assetPath: string): string => {
    // For Astro projects, use absolute API paths to avoid base path issues
    // For static projects, relative paths work fine
    if (projectSlug && version) {
      return withVivdStudioTokenQuery(
        `/vivd-studio/api/projects/${projectSlug}/v${version}/${assetPath}`,
        getVivdStudioToken(),
      );
    }
    // Fallback to relative path (works for static HTML projects)
    return assetPath;
  }, [projectSlug, version]);

  // Set up drop zones on all images in the iframe
  const enableDropZones = useCallback(
    (doc: Document, draggedAssetPath?: string | null) => {
      cleanupDropZoneDocument(doc);

      // Add drop zone styles if not already present
      if (!doc.getElementById("image-drop-zone-styles")) {
        const style = doc.createElement("style");
        style.id = "image-drop-zone-styles";
        style.textContent = DROP_ZONE_STYLES;
        doc.head.appendChild(style);
      }

      // Enable drag mode on body to disable overlay pointer events
      doc.body.classList.add("drag-mode-active");

      const handleDocumentCleanup = (event: DragEvent) => {
        event.preventDefault();
        cleanupDropZoneDocument(doc);
      };
      (doc as DropZoneDocument)._vivdImageDropDocumentHandlers = {
        dragend: handleDocumentCleanup,
        drop: handleDocumentCleanup,
      };
      doc.addEventListener("dragend", handleDocumentCleanup);
      doc.addEventListener("drop", handleDocumentCleanup);

      const images = doc.querySelectorAll("img");
      images.forEach((img) => {
        const dropSupport = getDropSupport?.(img, draggedAssetPath) ?? {
          canDrop: true,
        };

        // Mark as drop target
        img.setAttribute(
          "data-drop-target",
          dropSupport.canDrop ? "true" : "blocked",
        );
        // Store original src for potential revert
        if (!img.hasAttribute("data-original-src")) {
          img.setAttribute("data-original-src", img.src);
        }
        if (!img.hasAttribute("data-original-srcset")) {
          const originalSrcset = img.getAttribute("srcset");
          if (originalSrcset) {
            img.setAttribute("data-original-srcset", originalSrcset);
          }
        }

        // Prevent default image dragging
        img.draggable = false;

        // Add event listeners (use named functions for cleanup)
        const handleDragOver = (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const currentDropSupport = getDropSupport?.(img, draggedAssetPath) ?? {
            canDrop: true,
          };
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = currentDropSupport.canDrop
              ? "copy"
              : "none";
          }
          img.setAttribute(
            "data-drop-target",
            currentDropSupport.canDrop ? "active" : "blocked",
          );
          showDropHint(doc, img, currentDropSupport);
        };

        const handleDragLeave = (e: DragEvent) => {
          e.preventDefault();
          const currentDropSupport = getDropSupport?.(img, draggedAssetPath) ?? {
            canDrop: true,
          };
          img.setAttribute(
            "data-drop-target",
            currentDropSupport.canDrop ? "true" : "blocked",
          );
          hideDropHint(doc);
        };

        const handleDrop = async (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();

          const assetPath = e.dataTransfer?.getData("application/x-asset-path");
          const currentDropSupport = assetPath
            ? getDropSupport?.(img, assetPath) ?? { canDrop: true }
            : null;
          cleanupDropZoneDocument(doc);

          if (assetPath && currentDropSupport) {
            if (!currentDropSupport.canDrop) {
              toast.error(
                currentDropSupport.reason ??
                  "Vivd can't save this preview image drop safely yet.",
              );
              return;
            }

            let choice: ImageDropChoiceKind | null | undefined;
            if (currentDropSupport.plan?.requiresChoice) {
              if (!requestDropChoice) {
                toast.error(
                  "Vivd needs a media choice before this image can be dropped.",
                );
                return;
              }
              choice = await requestDropChoice(currentDropSupport.plan);
              if (!choice) {
                toast.info("Image drop canceled");
                return;
              }
            }

            // Update the image source to the new asset for preview display
            const previewUrl = buildImagePreviewUrl(assetPath);
            const previousSrcAttr = getPreviewImageBaselineSource(img);
            img.setAttribute("src", previewUrl);
            if (img.hasAttribute("srcset")) {
              img.setAttribute("srcset", previewUrl);
            }
            const picture = img.closest("picture");
            if (picture) {
              picture.querySelectorAll("source").forEach((source) => {
                if (!source.hasAttribute("data-original-srcset")) {
                  const originalSrcset = source.getAttribute("srcset");
                  if (originalSrcset) {
                    source.setAttribute("data-original-srcset", originalSrcset);
                  }
                }
                if (source.hasAttribute("srcset")) {
                  source.setAttribute("srcset", previewUrl);
                }
              });
            }

            if (onImageDropped) {
              // Pass the asset path (not the preview URL) to store in patches
              const accepted = await onImageDropped(
                assetPath,
                img,
                previousSrcAttr,
                {
                  plan: currentDropSupport.plan,
                  choice,
                },
              );
              if (accepted === false) {
                return;
              }
            }

            toast.success(
              currentDropSupport.plan?.label ??
                `Image replaced with ${assetPath.split("/").pop()}`,
            );
          }
        };

        // Store handlers for cleanup
        (img as DropZoneImage)._vivdImageDropHandlers = {
          dragover: handleDragOver,
          dragleave: handleDragLeave,
          drop: handleDrop,
        };

        img.addEventListener("dragover", handleDragOver);
        img.addEventListener("dragleave", handleDragLeave);
        img.addEventListener("drop", handleDrop);
      });
    },
    [buildImagePreviewUrl, getDropSupport, onImageDropped, requestDropChoice],
  );

  // Remove drop zones from all images
  const disableDropZones = useCallback((doc: Document) => {
    cleanupDropZoneDocument(doc);
  }, []);

  // Main effect: Listen for drag events on the document to toggle drop zones
  useEffect(() => {
    if (!enabled || !projectSlug) return;

    let isDragging = false;
    let draggedAssetPath: string | null = null;

    const readDraggedAssetPath = (e: DragEvent) => {
      const assetPath =
        e.dataTransfer?.getData("application/x-asset-path") ??
        e.dataTransfer?.getData("text/plain") ??
        "";
      const normalized = assetPath.trim();
      return normalized.length > 0 ? normalized : null;
    };

    const handleDragStart = (e: DragEvent) => {
      // Check if this drag contains our asset data (from Asset Explorer)
      // We can't check dataTransfer items during dragenter due to security,
      // but we can check if any valid types are present
      const hasData = e.dataTransfer?.types.includes(
        "application/x-asset-path"
      );
      if (!hasData) return;

      isDragging = true;
      draggedAssetPath = readDraggedAssetPath(e);

      // Enable drop zones in the iframe
      const iframe = iframeRef.current;
      if (iframe?.contentDocument) {
        enableDropZones(iframe.contentDocument, draggedAssetPath);
      }
    };

    const handleDragEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      draggedAssetPath = null;

      // Disable drop zones in the iframe
      const iframe = iframeRef.current;
      if (iframe?.contentDocument) {
        disableDropZones(iframe.contentDocument);
      }
    };

    // Also handle dragenter on the iframe to enable drop zones
    // (for when drag starts before iframe was set up)
    const handleIframeDragEnter = (e: DragEvent) => {
      if (isDragging) return;

      const hasAssetData = e.dataTransfer?.types.includes(
        "application/x-asset-path"
      );
      if (!hasAssetData) return;

      isDragging = true;
      draggedAssetPath = readDraggedAssetPath(e);
      const iframe = iframeRef.current;
      if (iframe?.contentDocument) {
        enableDropZones(iframe.contentDocument, draggedAssetPath);
      }
    };

    // Listen on the parent document for drag events
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("dragend", handleDragEnd);
    document.addEventListener("drop", handleDragEnd); // Also cleanup on drop anywhere

    // Also listen for dragenter on iframe wrapper
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener("dragenter", handleIframeDragEnter);
    }

    return () => {
      document.removeEventListener("dragstart", handleDragStart);
      document.removeEventListener("dragend", handleDragEnd);
      document.removeEventListener("drop", handleDragEnd);

      if (iframe) {
        iframe.removeEventListener("dragenter", handleIframeDragEnter);
        if (iframe.contentDocument) {
          disableDropZones(iframe.contentDocument);
        }
      }
    };
  }, [enabled, projectSlug, iframeRef, enableDropZones, disableDropZones]);

  return {
    enableDropZones,
    disableDropZones,
  };
}
