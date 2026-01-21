import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check } from "lucide-react";
import type { AssetItem } from "./types";

interface ImageThumbnailProps {
  item: AssetItem;
  imageUrl: string;
  selected?: boolean;
  showSelection?: boolean;
  onClick?: () => void;
  actions?: React.ReactNode;
  className?: string;
  draggable?: boolean;
}

export function ImageThumbnail({
  item,
  imageUrl,
  selected = false,
  showSelection = false,
  onClick,
  actions,
  className = "",
  draggable = true,
}: ImageThumbnailProps) {
  const hasResolution = item.width && item.height;
  const resolutionText = hasResolution ? `${item.width}×${item.height}` : null;
  const tooltipContent = (
    <div className="space-y-1">
      <p className="font-medium">{item.name}</p>
      {resolutionText && (
        <p className="text-xs text-muted-foreground">{resolutionText} px</p>
      )}
    </div>
  );

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // Set multiple data types for flexibility
    e.dataTransfer.setData("text/plain", item.path);
    e.dataTransfer.setData("application/x-asset-path", item.path);
    e.dataTransfer.setData("application/x-asset-url", imageUrl);
    e.dataTransfer.effectAllowed = "copy";

    // Create a custom drag image with a styled border
    const dragPreview = document.createElement("div");
    dragPreview.style.cssText = `
      width: 80px;
      height: 80px;
      border: 3px solid #22c55e;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4), 0 0 0 4px rgba(34, 197, 94, 0.2);
      overflow: hidden;
      background: white;
      position: absolute;
      top: -9999px;
      left: -9999px;
    `;

    const img = document.createElement("img");
    img.src = imageUrl;
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
    `;
    dragPreview.appendChild(img);
    document.body.appendChild(dragPreview);

    e.dataTransfer.setDragImage(dragPreview, 40, 40);

    // Clean up the element after drag starts
    requestAnimationFrame(() => {
      document.body.removeChild(dragPreview);
    });
  };

  return (
    <div
      onClick={onClick}
      draggable={draggable}
      onDragStart={handleDragStart}
      className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all group ${
        showSelection && selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-transparent hover:border-muted-foreground/50"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${className}`}
    >
      {/* Image container - native aspect ratio */}
      <div className="bg-muted">
        <img
          src={imageUrl}
          alt={item.name}
          className="w-full h-auto block"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </div>

      {/* Selection checkmark */}
      {showSelection && selected && (
        <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5">
          <Check className="h-3 w-3" />
        </div>
      )}

      {/* Action buttons (shown on hover) */}
      {actions && (
        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}

      {/* Bottom overlay with name and resolution - tooltip only here */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 cursor-default overflow-hidden">
            <p className="text-xs text-white truncate">{item.name}</p>
            {resolutionText && (
              <p className="text-[10px] text-white/70">{resolutionText}</p>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipContent}</TooltipContent>
      </Tooltip>
    </div>
  );
}
