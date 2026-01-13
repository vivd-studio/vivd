import { X } from "lucide-react";

interface ImagePreviewPillProps {
  previewUrl: string;
  fileName: string;
  onRemove: () => void;
}

export function ImagePreviewPill({
  previewUrl,
  fileName,
  onRemove,
}: ImagePreviewPillProps) {
  return (
    <div className="relative inline-flex items-center gap-2 bg-muted rounded-lg p-1.5 pr-2">
      <img
        src={previewUrl}
        alt={fileName}
        className="h-10 w-10 object-cover rounded"
      />
      <span className="text-xs text-muted-foreground truncate max-w-[100px]">
        {fileName}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/90 transition-colors"
        aria-label={`Remove ${fileName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
