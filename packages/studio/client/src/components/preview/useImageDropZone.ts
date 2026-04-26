import { useEffect, useCallback, type RefObject } from "react";
import { toast } from "sonner";
import { getVivdStudioToken, withVivdStudioTokenQuery } from "@/lib/studioAuth";
import { getPreviewImageBaselineSource } from "./imageDropHeuristics";

interface UseImageDropZoneOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  projectSlug?: string;
  version?: number;
  enabled?: boolean;
  getDropSupport?: (
    targetImg: HTMLImageElement,
    assetPath?: string | null,
  ) => { canDrop: boolean; reason?: string };
  onImageDropped?: (
    imagePath: string,
    targetImg: HTMLImageElement,
    previousSrcAttr: string | null
  ) => void;
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
  
  /* Hover state: About to drop */
  [data-drop-target="active"] {
    border: 5px solid #22c55e !important;
    box-sizing: border-box !important;
    animation: dropzone-pulse-border 0.6s ease-in-out infinite !important;
    filter: brightness(1.15) !important;
    cursor: copy !important;
    z-index: 10000 !important;
  }
`;

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
      // Add drop zone styles if not already present
      if (!doc.getElementById("image-drop-zone-styles")) {
        const style = doc.createElement("style");
        style.id = "image-drop-zone-styles";
        style.textContent = DROP_ZONE_STYLES;
        doc.head.appendChild(style);
      }

      // Enable drag mode on body to disable overlay pointer events
      doc.body.classList.add("drag-mode-active");

      const images = doc.querySelectorAll("img");
      images.forEach((img) => {
        const dropSupport = getDropSupport?.(img, draggedAssetPath) ?? {
          canDrop: true,
        };
        if (!dropSupport.canDrop) {
          return;
        }

        // Mark as drop target
        img.setAttribute("data-drop-target", "true");
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
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = "copy";
          }
          img.setAttribute("data-drop-target", "active");
        };

        const handleDragLeave = (e: DragEvent) => {
          e.preventDefault();
          img.setAttribute("data-drop-target", "true");
        };

        const handleDrop = (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          img.setAttribute("data-drop-target", "true");

          const assetPath = e.dataTransfer?.getData("application/x-asset-path");

          if (assetPath) {
            const currentDropSupport = getDropSupport?.(img, assetPath) ?? {
              canDrop: true,
            };
            if (!currentDropSupport.canDrop) {
              toast.error(
                currentDropSupport.reason ??
                  "Vivd can't save this preview image drop safely yet.",
              );
              return;
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

            toast.success(`Image replaced with ${assetPath.split("/").pop()}`);

            if (onImageDropped) {
              // Pass the asset path (not the preview URL) to store in patches
              onImageDropped(assetPath, img, previousSrcAttr);
            }
          }
        };

        // Store handlers for cleanup
        (img as any)._dropHandlers = {
          dragover: handleDragOver,
          dragleave: handleDragLeave,
          drop: handleDrop,
        };

        img.addEventListener("dragover", handleDragOver);
        img.addEventListener("dragleave", handleDragLeave);
        img.addEventListener("drop", handleDrop);
      });
    },
    [buildImagePreviewUrl, getDropSupport, onImageDropped],
  );

  // Remove drop zones from all images
  const disableDropZones = useCallback((doc: Document) => {
    const style = doc.getElementById("image-drop-zone-styles");
    if (style) style.remove();

    // Remove drag mode from body
    if (doc.body) {
      doc.body.classList.remove("drag-mode-active");
    }

    const images = doc.querySelectorAll("img[data-drop-target]");
    images.forEach((img) => {
      img.removeAttribute("data-drop-target");

      // Remove event listeners
      const handlers = (img as any)._dropHandlers;
      if (handlers) {
        img.removeEventListener("dragover", handlers.dragover);
        img.removeEventListener("dragleave", handlers.dragleave);
        img.removeEventListener("drop", handlers.drop);
        delete (img as any)._dropHandlers;
      }
    });
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
