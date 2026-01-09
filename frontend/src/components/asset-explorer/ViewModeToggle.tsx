import { Images, FolderTree } from "lucide-react";
import type { ViewMode } from "./types";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex items-center border rounded-md overflow-hidden">
      <button
        onClick={() => onChange("gallery")}
        className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
          value === "gallery"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
        aria-label="Gallery view"
      >
        <Images className="h-3.5 w-3.5" />
        Gallery
      </button>
      <div className="w-px h-5 bg-border" />
      <button
        onClick={() => onChange("files")}
        className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
          value === "files"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
        aria-label="Files view"
      >
        <FolderTree className="h-3.5 w-3.5" />
        Files
      </button>
    </div>
  );
}
