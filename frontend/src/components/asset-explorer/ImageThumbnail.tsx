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
}

export function ImageThumbnail({
  item,
  imageUrl,
  selected = false,
  showSelection = false,
  onClick,
  actions,
  className = "",
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

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all group ${
        showSelection && selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-transparent hover:border-muted-foreground/50"
      } ${className}`}
    >
      {/* Image container */}
      <div className="aspect-square bg-muted">
        <img
          src={imageUrl}
          alt={item.name}
          className="w-full h-full object-cover"
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
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 cursor-default">
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
