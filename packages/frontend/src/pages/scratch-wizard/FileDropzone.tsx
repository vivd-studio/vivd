import { useState, useCallback, useEffect } from "react";
import type { DragEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { FileImage, Upload, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
    [onFiles],
  );

  return { isDragging, onDragEnter, onDragLeave, onDragOver, onDrop };
}

type FileDropzoneProps = {
  title: string;
  hint: string;
  files: File[];
  onAddFiles: (files: File[]) => void;
  /** If true, only image files are accepted. Defaults to true. */
  acceptOnlyImages?: boolean;
  icon?: LucideIcon;
  className?: string;
};

type FileAttachmentListProps = {
  files: File[];
  onRemoveFile: (index: number) => void;
  className?: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.at(-1)?.toUpperCase() || "FILE" : "FILE";
}

function FileAttachmentPreview({ file }: { file: File }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    if (!isImage) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, isImage]);

  if (isImage && previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={`${file.name} preview`}
        className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-black/6 dark:ring-white/10"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/58 text-foreground/76">
      <div className="flex flex-col items-center gap-0.5">
        <FileImage className="h-3.5 w-3.5" />
        <span className="max-w-[2.25rem] truncate text-[8px] font-semibold uppercase tracking-[0.1em]">
          {getFileExtension(file.name)}
        </span>
      </div>
    </div>
  );
}

export function FileAttachmentList({
  files,
  onRemoveFile,
  className,
}: FileAttachmentListProps) {
  if (files.length === 0) {
    return <div aria-hidden className={cn("hidden md:block", className)} />;
  }

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {files.map((file, idx) => (
        <div
          key={`${file.name}-${idx}`}
          className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-border/60 bg-card/78 px-2.5 py-2.5 text-left text-foreground shadow-[0_12px_36px_hsl(var(--primary)/0.08)] backdrop-blur-xl"
        >
          <FileAttachmentPreview file={file} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{file.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatFileSize(file.size)}
            </div>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground"
            onClick={() => onRemoveFile(idx)}
            aria-label={`Remove ${file.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function FileDropzone({
  title,
  hint,
  files,
  onAddFiles,
  acceptOnlyImages = true,
  icon: Icon = Upload,
  className,
}: FileDropzoneProps) {
  const { isDragging, onDragEnter, onDragLeave, onDragOver, onDrop } =
    useDropzone(onAddFiles);

  return (
    <div className={cn("h-full", className)}>
      <label
        className={cn(
          "flex min-h-[108px] h-full cursor-pointer rounded-[24px] border border-dashed border-border/60 bg-card/34 p-4 text-left shadow-[0_22px_54px_hsl(var(--primary)/0.1)] backdrop-blur-xl transition duration-200",
          isDragging
            ? "border-primary/70 bg-primary/10 shadow-[0_24px_80px_hsl(var(--primary)/0.14)]"
            : "hover:border-primary/22 hover:bg-card/52",
        )}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
          onDrop={onDrop}
      >
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/46 text-foreground/78">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{title}</div>
              <div className="text-xs text-muted-foreground">{hint}</div>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="shrink-0 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] font-normal text-muted-foreground"
          >
            {files.length > 0
              ? `${files.length} file${files.length === 1 ? "" : "s"}`
              : "Drop files"}
          </Badge>
        </div>

        <input
          type="file"
          multiple
          accept={acceptOnlyImages ? "image/*" : undefined}
          className="hidden"
          onChange={(e) => {
            const selectedFiles = Array.from(e.target.files || []);
            if (selectedFiles.length) onAddFiles(selectedFiles);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}
