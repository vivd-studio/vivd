import { useState, useCallback } from "react";
import type { DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, X } from "lucide-react";

function useDropzone(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files || []);
      if (dropped.length) onFiles(dropped);
    },
    [onFiles]
  );

  return { isDragging, onDragEnter, onDragLeave, onDragOver, onDrop };
}

type FileDropzoneProps = {
  title: string;
  hint: string;
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
};

export function FileDropzone({
  title,
  hint,
  files,
  onAddFiles,
  onRemoveFile,
}: FileDropzoneProps) {
  const { isDragging, onDragEnter, onDragLeave, onDragOver, onDrop } =
    useDropzone(onAddFiles);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="secondary" className="text-xs font-normal">
          {files.length} files
        </Badge>
      </div>
      <label
        className={`flex cursor-pointer items-center justify-center rounded-xl border border-dashed p-4 transition-all duration-200 ${
          isDragging
            ? "border-primary bg-primary/10"
            : "border-border hover:border-primary/50 hover:bg-muted/50"
        }`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <input
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const selectedFiles = Array.from(e.target.files || []);
            if (selectedFiles.length) onAddFiles(selectedFiles);
            e.currentTarget.value = "";
          }}
        />
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Upload className="h-4 w-4" />
          <span>{hint}</span>
        </div>
      </label>

      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {files.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{file.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onRemoveFile(idx)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
