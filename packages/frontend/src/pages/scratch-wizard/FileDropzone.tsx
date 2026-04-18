import { useState, useCallback, useEffect, useRef } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { FileImage, FolderArchive, ImagePlus, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from "@vivd/ui";


// ---------------------------------------------------------------------------
// Drag-and-drop hook (unchanged)
// ---------------------------------------------------------------------------

export function useDropzone(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files || []);
      if (dropped.length) onFiles(dropped);
    },
    [onFiles],
  );

  return { isDragging, onDragEnter, onDragLeave, onDragOver, onDrop };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.at(-1)?.toUpperCase() || "FILE" : "FILE";
}

// ---------------------------------------------------------------------------
// File thumbnail preview (shared)
// ---------------------------------------------------------------------------

function FilePreviewThumb({
  file,
  size = "sm",
}: {
  file: File;
  size?: "sm" | "xs";
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isImage = file.type.startsWith("image/");
  const dim = size === "sm" ? "h-9 w-9" : "h-7 w-7";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-3 w-3";

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
        className={cn(
          dim,
          "shrink-0 rounded-lg object-cover ring-1 ring-black/6 dark:ring-white/10",
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/58 text-foreground/76",
      )}
    >
      <div className="flex flex-col items-center gap-0.5">
        <FileImage className={iconSize} />
        {size === "sm" && (
          <span className="max-w-8 truncate text-[7px] font-semibold uppercase tracking-[0.08em]">
            {getFileExtension(file.name)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline file chip — compact chip for inside the prompt surface
// ---------------------------------------------------------------------------

type FileChipType = "asset" | "reference";

function InlineFileChip({
  file,
  type,
  onRemove,
}: {
  file: File;
  type: FileChipType;
  onRemove: () => void;
}) {
  return (
    <div className="group/chip flex min-w-0 max-w-[200px] items-center gap-2 rounded-xl border border-border/50 bg-card/60 px-2 py-1.5 text-left shadow-sm backdrop-blur-sm transition-colors hover:bg-card/80">
      <FilePreviewThumb file={file} size="xs" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium leading-tight text-foreground">
          {file.name}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wider",
              type === "reference"
                ? "bg-blue-500/15 text-blue-400"
                : "bg-emerald-500/15 text-emerald-400",
            )}
          >
            {type === "reference" ? "ref" : "asset"}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-foreground/8 hover:text-foreground group-hover/chip:opacity-100"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineAttachmentArea — scrollable chip area inside the prompt surface
// ---------------------------------------------------------------------------

type InlineAttachmentAreaProps = {
  assets: File[];
  referenceImages: File[];
  onRemoveAsset: (index: number) => void;
  onRemoveReference: (index: number) => void;
  className?: string;
};

export function InlineAttachmentArea({
  assets,
  referenceImages,
  onRemoveAsset,
  onRemoveReference,
  className,
}: InlineAttachmentAreaProps) {
  const totalFiles = assets.length + referenceImages.length;
  if (totalFiles === 0) return null;

  return (
    <div
      className={cn(
        "max-h-[164px] overflow-y-auto border-t border-border/25 px-4 pt-3 pb-1",
        className,
      )}
    >
      <div className="flex flex-wrap gap-2">
        {assets.map((file, idx) => (
          <InlineFileChip
            key={`asset-${file.name}-${idx}`}
            file={file}
            type="asset"
            onRemove={() => onRemoveAsset(idx)}
          />
        ))}
        {referenceImages.map((file, idx) => (
          <InlineFileChip
            key={`ref-${file.name}-${idx}`}
            file={file}
            type="reference"
            onRemove={() => onRemoveReference(idx)}
          />
        ))}
      </div>
      <div className="mt-1.5 pb-1 text-[10px] text-muted-foreground/60">
        {totalFiles} file{totalFiles === 1 ? "" : "s"} attached
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentMenuButton — paperclip dropdown with two options
// ---------------------------------------------------------------------------

type AttachmentMenuButtonProps = {
  onAddAssets: (files: File[]) => void;
  onAddReferences: (files: File[]) => void;
  disabled?: boolean;
};

export function AttachmentMenuButton({
  onAddAssets,
  onAddReferences,
  disabled,
}: AttachmentMenuButtonProps) {
  const assetInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  const handleFileInput = (
    e: ChangeEvent<HTMLInputElement>,
    handler: (files: File[]) => void,
  ) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length) handler(selectedFiles);
    e.currentTarget.value = "";
  };

  return (
    <>
      <input
        ref={assetInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFileInput(e, onAddAssets)}
      />
      <input
        ref={referenceInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileInput(e, onAddReferences)}
      />
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                aria-label="Attach files"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">Attach files</TooltipContent>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuItem
              onSelect={() => assetInputRef.current?.click()}
              className="gap-3 py-2"
            >
              <FolderArchive className="h-4 w-4 text-emerald-400" />
              <div>
                <div className="text-sm font-medium">Brand assets</div>
                <div className="text-xs text-muted-foreground">
                  Logos, photos, files for the page
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => referenceInputRef.current?.click()}
              className="gap-3 py-2"
            >
              <ImagePlus className="h-4 w-4 text-blue-400" />
              <div>
                <div className="text-sm font-medium">Design references</div>
                <div className="text-xs text-muted-foreground">
                  Inspiration screenshots only
                </div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </>
  );
}

// ---------------------------------------------------------------------------
// Legacy exports (kept for backwards compat, not used by ScratchForm)
// ---------------------------------------------------------------------------

export type FileDropzoneProps = {
  title: string;
  hint: string;
  files: File[];
  onAddFiles: (files: File[]) => void;
  acceptOnlyImages?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
};

export type FileAttachmentListProps = {
  files: File[];
  onRemoveFile: (index: number) => void;
  className?: string;
};

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
          <FilePreviewThumb file={file} />
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
  files: _files,
  onAddFiles,
  acceptOnlyImages = true,
  icon: Icon = Paperclip,
  className,
}: FileDropzoneProps) {
  const { isDragging, onDragEnter, onDragLeave, onDragOver, onDrop } =
    useDropzone(onAddFiles);

  return (
    <div className={cn("h-full", className)}>
      <label
        className={cn(
          "flex min-h-[88px] h-full cursor-pointer rounded-[20px] border border-dashed border-border/45 bg-card/20 p-3.5 text-left shadow-[0_10px_28px_hsl(var(--primary)/0.05)] backdrop-blur-xl transition duration-200",
          isDragging
            ? "border-primary/55 bg-primary/8 shadow-[0_16px_40px_hsl(var(--primary)/0.1)]"
            : "hover:border-border/65 hover:bg-card/28",
        )}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/46 text-foreground/78">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{title}</div>
              <div className="text-xs text-muted-foreground">{hint}</div>
            </div>
          </div>
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
