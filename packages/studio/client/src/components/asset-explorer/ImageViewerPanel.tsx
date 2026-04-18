import { useCallback, useEffect, useState, useRef } from "react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@vivd/ui";

import {
  Download,
  X,
  Image as ImageIcon,
  AlertCircle,
  Wand2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MessageSquarePlus,
} from "lucide-react";
import { toast } from "sonner";
import { getStudioImageUrlCandidates } from "./utils";
import { useOptionalChatContext } from "@/components/chat/ChatContext";

interface ImageViewerPanelProps {
  projectSlug: string;
  version: number;
  filePath: string;
  onClose: () => void;
  onAiEdit?: () => void;
  onDelete?: () => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  canNavigatePrevious?: boolean;
  canNavigateNext?: boolean;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;

export function ImageViewerPanel({
  projectSlug,
  version,
  filePath,
  onClose,
  onAiEdit,
  onDelete,
  onNavigatePrevious,
  onNavigateNext,
  canNavigatePrevious = false,
  canNavigateNext = false,
}: ImageViewerPanelProps) {
  const imageUrls = getStudioImageUrlCandidates(projectSlug, version, filePath);
  const filename = filePath.split("/").pop() || filePath;
  const containerRef = useRef<HTMLDivElement>(null);
  const chatContext = useOptionalChatContext();

  const hasNavigation = onNavigatePrevious || onNavigateNext;

  // Zoom state
  const [zoom, setZoom] = useState(1);
  const [imageUrlIndex, setImageUrlIndex] = useState(0);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const imageUrl = imageUrls[imageUrlIndex] ?? imageUrls[0] ?? "";

  const handleAddToChat = useCallback(() => {
    if (!chatContext) return;
    chatContext.addAttachedFile({
      path: filePath,
      filename: filename,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    });
    toast.success(`Added ${filename} to chat`);
  }, [chatContext, filePath, filename]);

  // Reset zoom when image changes
  useEffect(() => {
    setZoom(1);
    setImageUrlIndex(0);
    setImageLoadFailed(false);
  }, [filePath]);

  // Handle download
  const handleDownload = useCallback(() => {
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [imageUrl, filename]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((prev) => Math.min(Math.max(prev + delta, MIN_ZOOM), MAX_ZOOM));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      // Left arrow to navigate previous
      if (e.key === "ArrowLeft" && onNavigatePrevious && canNavigatePrevious) {
        e.preventDefault();
        onNavigatePrevious();
      }
      // Right arrow to navigate next
      if (e.key === "ArrowRight" && onNavigateNext && canNavigateNext) {
        e.preventDefault();
        onNavigateNext();
      }
      // Plus/equals for zoom in
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        handleZoomIn();
      }
      // Minus for zoom out
      if (e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      }
      // 0 to reset zoom
      if (e.key === "0") {
        e.preventDefault();
        handleResetZoom();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onClose,
    onNavigatePrevious,
    onNavigateNext,
    canNavigatePrevious,
    canNavigateNext,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
  ]);

  return (
    <div className="absolute inset-0 z-10 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Navigation buttons - left side */}
          {hasNavigation && (
            <div className="flex items-center gap-1 mr-2 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onNavigatePrevious}
                    disabled={!canNavigatePrevious}
                    className="h-8 w-8 p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous (←)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onNavigateNext}
                    disabled={!canNavigateNext}
                    className="h-8 w-8 p-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next (→)</TooltipContent>
              </Tooltip>
            </div>
          )}
          <ImageIcon className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate" title={filename}>{filename}</h2>
            <p className="text-xs text-muted-foreground truncate" title={filePath}>{filePath}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 mr-2 border-r pr-2">
            {zoom !== 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetZoom}
                    className="h-8 w-8 p-0"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset zoom (0)</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  className="h-8 w-8 p-0"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out (−)</TooltipContent>
            </Tooltip>
            <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  className="h-8 w-8 p-0"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in (+)</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                className="h-8 w-8 p-0"
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>

          {chatContext && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddToChat}
                  className="h-8 w-8 p-0"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add to Chat</TooltipContent>
            </Tooltip>
          )}

          {onAiEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onAiEdit}
                  className="h-8 w-8 p-0"
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit with AI</TooltipContent>
            </Tooltip>
          )}

          {onDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Image display with zoom */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex items-center justify-center p-4 bg-muted/10"
        onWheel={handleWheel}
      >
        {imageLoadFailed ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-8 text-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Could not load this image</p>
              <p className="text-xs text-muted-foreground">
                The local runtime did not return a displayable image response.
              </p>
            </div>
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={filename}
            className="max-w-full max-h-full object-contain rounded shadow-lg transition-transform duration-100"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              maxWidth: zoom > 1 ? "none" : undefined,
              maxHeight: zoom > 1 ? "none" : undefined,
            }}
            draggable={false}
            onLoad={() => setImageLoadFailed(false)}
            onError={() => {
              if (imageUrlIndex < imageUrls.length - 1) {
                setImageUrlIndex((index) => index + 1);
                return;
              }
              setImageLoadFailed(true);
            }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <span>
          {hasNavigation
            ? "Use ← → to navigate • Scroll to zoom • Escape to close"
            : "Scroll to zoom • Escape to close"}
        </span>
      </div>
    </div>
  );
}
