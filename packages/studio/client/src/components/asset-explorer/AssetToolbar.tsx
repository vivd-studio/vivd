import { useRef } from "react";
import { Button } from "@vivd/ui";

import {
  ChevronLeft,
  FolderPlus,
  Upload,
  Loader2,
  ImagePlus,
  RefreshCw,
} from "lucide-react";

interface AssetToolbarProps {
  currentPath?: string;
  uploadTargetPath: string;
  uploadStatus: "idle" | "uploading" | "optimizing";
  onBack?: () => void;
  onCreateFolder: () => void;
  onCreateImage?: () => void;
  onFilesSelected: (files: FileList) => void;
  onRefresh?: () => void;
}

export function AssetToolbar({
  currentPath,
  uploadTargetPath,
  uploadStatus,
  onBack,
  onCreateFolder,
  onCreateImage,
  onFilesSelected,
  onRefresh,
}: AssetToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showNavigation = currentPath !== undefined && onBack !== undefined;
  const pathParts = currentPath?.split("/").filter(Boolean) ?? [];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
  };

  const isProcessing = uploadStatus !== "idle";

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
        {onRefresh && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="outline"
          size={isProcessing ? "default" : "icon"}
          className={`h-8 ${isProcessing ? "px-3" : "w-8"}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          title={
            isProcessing ? "Processing..." : `Upload files to ${uploadTargetPath}`
          }
        >
          {isProcessing ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">
                {uploadStatus === "optimizing"
                  ? "Optimizing..."
                  : "Uploading..."}
              </span>
            </div>
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
