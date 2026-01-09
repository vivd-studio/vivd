import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  FolderPlus,
  Upload,
  Loader2,
  ImagePlus,
} from "lucide-react";

interface AssetToolbarProps {
  currentPath?: string;
  isUploading: boolean;
  onBack?: () => void;
  onCreateFolder: () => void;
  onCreateImage?: () => void;
  onFilesSelected: (files: FileList) => void;
}

export function AssetToolbar({
  currentPath,
  isUploading,
  onBack,
  onCreateFolder,
  onCreateImage,
  onFilesSelected,
}: AssetToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showNavigation = currentPath !== undefined && onBack !== undefined;
  const pathParts = currentPath?.split("/").filter(Boolean) ?? [];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
  };

  return (
    <div className="px-2 py-2 border-b flex flex-wrap items-center gap-1 shrink-0">
      {showNavigation && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onBack}
            disabled={!currentPath}
            title="Go back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-xs text-muted-foreground flex-1 min-w-0 truncate px-1">
            /{pathParts.join("/")}
          </div>
        </>
      )}
      <div
        className={`flex items-center gap-1 shrink-0 ${
          !showNavigation ? "ml-auto" : ""
        }`}
      >
        {onCreateImage && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onCreateImage}
            title="Create Image with AI"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={onCreateFolder}
          title="New Folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          title="Upload files"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
