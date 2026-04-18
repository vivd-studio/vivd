import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Progress, InteractiveSurface, Tooltip, TooltipContent, TooltipTrigger } from "@vivd/ui";

import { ArrowUp, Link2, Loader2, X } from "lucide-react";
import { useScratchWizard } from "./ScratchWizardContext";
import {
  InlineAttachmentArea,
  AttachmentMenuButton,
  useDropzone,
} from "./FileDropzone";
import { cn } from "@/lib/utils";
import { ScratchModelSelector } from "./ScratchModelSelector";

const TEXTAREA_MIN_HEIGHT = 84;
const TEXTAREA_MAX_HEIGHT = 248;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function ScratchForm() {
  const {
    form,
    assets,
    setAssets,
    referenceImages,
    setReferenceImages,
    started,
    statusData,
    isGenerating,
    progress,
    uploadPhase,
    uploadProgress,
    validationError,
    availableModels,
    selectedModel,
    setSelectedModel,
    submit,
  } = useScratchWizard();
  const titleField = form.register("title");
  const descriptionField = form.register("description");
  const referenceUrlsField = form.register("referenceUrlsText");
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);

  const isDisabled = isGenerating || !!started;
  const titleError = form.formState.errors.title?.message;
  const descriptionError = form.formState.errors.description?.message;

  const totalAttachments = assets.length + referenceImages.length;

  const resizeDescription = useCallback(
    (element?: HTMLTextAreaElement | null) => {
      const textarea = element ?? descriptionRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";
      const nextHeight = Math.min(
        Math.max(textarea.scrollHeight, TEXTAREA_MIN_HEIGHT),
        TEXTAREA_MAX_HEIGHT,
      );
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
    },
    [],
  );

  useEffect(() => {
    resizeDescription();
  }, [resizeDescription]);

  const getStatusLabel = () => {
    switch (uploadPhase) {
      case "creating":
        return "Creating project…";
      case "uploading":
        return "Uploading assets…";
      case "starting":
        return "Starting generation…";
      case "generating":
        return statusData?.status || "Generating…";
      default:
        return statusData?.status || "starting";
    }
  };

  const getStatusBadge = () => {
    if (uploadPhase === "uploading") {
      return `${uploadProgress.uploadedFiles}/${uploadProgress.totalFiles} files`;
    }
    if (uploadPhase === "generating" && statusData?.status) {
      return statusData.status;
    }
    return uploadPhase;
  };

  // Drag-and-drop on the entire prompt surface → brand assets by default
  const handleSurfaceDrop = useCallback(
    (files: File[]) => {
      if (!isDisabled) {
        setAssets((prev) => [...prev, ...files]);
      }
    },
    [isDisabled, setAssets],
  );

  const {
    isDragging,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
  } = useDropzone(handleSurfaceDrop);

  return (
    <form
      onSubmit={form.handleSubmit(submit)}
      className="w-full max-w-4xl"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          What should we build?
        </h1>
      </div>

      <div className="mx-auto mt-10 flex w-full max-w-[52rem] flex-col gap-4">
        <div className="mx-auto w-full max-w-[30rem] space-y-1.5">
          <label className="block text-center text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Project name
          </label>
          <Input
            {...titleField}
            placeholder="Acme Studio"
            disabled={isDisabled}
            className="h-12 rounded-full border border-border/60 bg-card/68 px-5 text-center text-base text-foreground shadow-[0_24px_80px_hsl(var(--primary)/0.12)] backdrop-blur-xl placeholder:text-muted-foreground focus-visible:border-primary/24 focus-visible:bg-card/88 focus-visible:ring-primary/16"
          />
          {titleError ? (
            <div className="text-center text-xs text-destructive">
              {titleError}
            </div>
          ) : null}
        </div>

        <InteractiveSurface
          variant="field"
          className={cn(
            "relative overflow-hidden rounded-[30px] border border-border/60 bg-card/92 text-foreground shadow-[0_36px_110px_hsl(var(--primary)/0.16)] backdrop-blur-2xl transition-all duration-200",
            isDisabled
              ? "opacity-90"
              : "hover:border-primary/18",
            isDragging &&
              "border-primary/55 bg-primary/5 shadow-[0_36px_110px_hsl(var(--primary)/0.24)]",
          )}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[30px] border-2 border-dashed border-primary/40 bg-primary/5 backdrop-blur-[2px]">
              <div className="flex flex-col items-center gap-2 text-primary">
                <div className="rounded-full border border-primary/30 bg-primary/10 p-3">
                  <ArrowUp className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium">
                  Drop files to attach
                </span>
              </div>
            </div>
          )}

          <textarea
            name={descriptionField.name}
            onBlur={descriptionField.onBlur}
            ref={(node) => {
              descriptionRef.current = node;
              descriptionField.ref(node);
            }}
            onChange={(event) => {
              descriptionField.onChange(event);
              resizeDescription(event.currentTarget);
            }}
            rows={1}
            placeholder="Describe the website you want to create."
            disabled={isDisabled}
            className="min-h-[84px] max-h-[248px] w-full resize-none overflow-y-hidden bg-transparent px-6 pt-4 text-base leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          />

          {/* Inline attachments area */}
          <InlineAttachmentArea
            assets={assets}
            referenceImages={referenceImages}
            onRemoveAsset={(idx) =>
              setAssets((prev) => prev.filter((_, i) => i !== idx))
            }
            onRemoveReference={(idx) =>
              setReferenceImages((prev) => prev.filter((_, i) => i !== idx))
            }
          />

          {/* Reference URLs inline input */}
          {showUrlInput && (
            <div className="border-t border-border/25 px-4 py-2.5">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <textarea
                    {...referenceUrlsField}
                    rows={2}
                    disabled={isDisabled}
                    placeholder={"https://example.com\nhttps://another-example.com"}
                    className="min-h-[48px] w-full resize-y rounded-xl border border-border/30 bg-background/25 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border/50 focus:bg-background/40 disabled:cursor-not-allowed disabled:opacity-70"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground/60">
                    Paste inspiration URLs — we'll use them as loose references
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/6 hover:text-foreground"
                  onClick={() => setShowUrlInput(false)}
                  aria-label="Close URL input"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Toolbar row */}
          <div className="flex items-center justify-between gap-2 px-4 pb-4 pl-4 sm:px-5 sm:pb-4">
            <div className="flex items-center gap-1">
              <AttachmentMenuButton
                onAddAssets={(files) =>
                  setAssets((prev) => [...prev, ...files])
                }
                onAddReferences={(files) =>
                  setReferenceImages((prev) => [...prev, ...files])
                }
                disabled={isDisabled}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={isDisabled}
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
                      showUrlInput && "bg-foreground/8 text-foreground",
                    )}
                    onClick={() => setShowUrlInput((v) => !v)}
                    aria-label="Add reference URLs"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Reference URLs</TooltipContent>
              </Tooltip>
              {totalAttachments > 0 && (
                <span className="ml-1 rounded-full bg-foreground/6 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {totalAttachments} file{totalAttachments === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ScratchModelSelector
                models={availableModels}
                selectedModel={selectedModel}
                onSelect={setSelectedModel}
                disabled={isDisabled}
              />
              <Button
                type="submit"
                disabled={isDisabled}
                className="h-10 w-10 shrink-0 rounded-full border-0 bg-primary text-primary-foreground shadow-[0_18px_44px_hsl(var(--primary)/0.34)] hover:bg-primary/90"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </InteractiveSurface>

        {descriptionError ? (
          <div className="text-center text-xs text-destructive">
            {descriptionError}
          </div>
        ) : null}

        {validationError ? (
          <div className="rounded-[24px] border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive shadow-[0_24px_80px_hsl(var(--destructive)/0.12)] backdrop-blur-xl">
            {validationError}
          </div>
        ) : null}

        {uploadPhase !== "idle" ? (
          <div className="space-y-3 rounded-[24px] border border-border/60 bg-card/64 px-4 py-4 text-foreground shadow-[0_24px_80px_hsl(var(--primary)/0.1)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span className="truncate">{getStatusLabel()}</span>
              </div>
              <div className="shrink-0 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground">
                {getStatusBadge()}
              </div>
            </div>
            <Progress value={progress} className="h-1.5 bg-muted" />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {uploadPhase === "uploading" && uploadProgress.totalBytes > 0 ? (
                <span>
                  {formatBytes(uploadProgress.uploadedBytes)} /{" "}
                  {formatBytes(uploadProgress.totalBytes)}
                </span>
              ) : null}
              {started?.slug ? (
                <span>
                  Project:{" "}
                  <span className="font-mono text-foreground/80">
                    {started.slug}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}
