import { X, FileText } from "lucide-react";

interface FilePreviewPillProps {
  previewUrl: string;
  fileName: string;
  onRemove: () => void;
}

export function FilePreviewPill({
  previewUrl,
  fileName,
  onRemove,
}: FilePreviewPillProps) {
  const isImage = previewUrl && previewUrl.length > 0;

  return (
    <div className="relative inline-flex items-center gap-2 bg-muted rounded-lg p-1.5 pr-2">
      {isImage ? (
        <img
          src={previewUrl}
          alt={fileName}
          className="h-10 w-10 object-cover rounded"
        />
      ) : (
        <div className="h-10 w-10 flex items-center justify-center bg-muted-foreground/10 rounded">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <span className="text-sm text-muted-foreground truncate max-w-[100px]">
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

// Re-export with old name for backwards compatibility
export { FilePreviewPill as ImagePreviewPill };
