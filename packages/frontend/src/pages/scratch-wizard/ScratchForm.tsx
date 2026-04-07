import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { InteractiveSurface } from "@/components/ui/interactive-surface";
import {
  ArrowUp,
  ChevronDown,
  FolderArchive,
  ImagePlus,
  Loader2,
} from "lucide-react";
import { useScratchWizard } from "./ScratchWizardContext";
import { FileAttachmentList, FileDropzone } from "./FileDropzone";
import { cn } from "@/lib/utils";

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
    submit,
  } = useScratchWizard();
  const titleField = form.register("title");
  const descriptionField = form.register("description");
  const referenceUrlsField = form.register("referenceUrlsText");
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const isDisabled = isGenerating || !!started;
  const titleError = form.formState.errors.title?.message;
  const descriptionError = form.formState.errors.description?.message;

  const resizeDescription = useCallback((element?: HTMLTextAreaElement | null) => {
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
  }, []);

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
            <div className="text-center text-xs text-destructive">{titleError}</div>
          ) : null}
        </div>

        <InteractiveSurface
          variant="field"
          className={cn(
            "overflow-hidden rounded-[30px] border border-border/60 bg-card/92 text-foreground shadow-[0_36px_110px_hsl(var(--primary)/0.16)] backdrop-blur-2xl",
            isDisabled
              ? "opacity-90"
              : "hover:border-primary/18",
          )}
        >
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

          <div className="flex items-center justify-between gap-4 px-4 pb-4 pl-5 sm:px-5 sm:pb-4">
            <div className="text-left text-xs leading-5 text-muted-foreground">
              Brief, sections, tone, assets.
            </div>

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
                  Project: <span className="font-mono text-foreground/80">{started.slug}</span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 md:items-start">
          <FileDropzone
            className="order-1"
            title="Design references"
            hint="Inspiration only"
            files={referenceImages}
            onAddFiles={(files) =>
              setReferenceImages((prev) => [...prev, ...files])
            }
            icon={ImagePlus}
          />
          <FileDropzone
            className="order-3 md:order-2"
            title="Brand assets"
            hint="Logos, photos, files to be used on the page"
            files={assets}
            onAddFiles={(files) => setAssets((prev) => [...prev, ...files])}
            acceptOnlyImages={false}
            icon={FolderArchive}
          />
          <FileAttachmentList
            className="order-2 md:order-3"
            files={referenceImages}
            onRemoveFile={(idx) =>
              setReferenceImages((prev) => prev.filter((_, i) => i !== idx))
            }
          />
          <FileAttachmentList
            className="order-4"
            files={assets}
            onRemoveFile={(idx) =>
              setAssets((prev) => prev.filter((_, i) => i !== idx))
            }
          />
        </div>

        <details className="mx-auto w-full max-w-[42rem] rounded-[18px] border border-border/35 bg-card/22 px-4 py-3 text-left shadow-[0_14px_36px_hsl(var(--primary)/0.04)] backdrop-blur-xl group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:content-none">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground/88">
                Websites you like
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Optional inspiration URLs
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 border-t border-border/25 pt-3">
            <p className="mb-2 text-xs leading-5 text-muted-foreground">
              Paste a few sites or design references we should loosely follow.
            </p>
            <textarea
              {...referenceUrlsField}
              rows={2}
              disabled={isDisabled}
              placeholder={"https://example.com\nhttps://another-example.com"}
              className="min-h-[60px] w-full resize-y rounded-[16px] border border-border/35 bg-background/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border/55 focus:bg-background/46 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        </details>
      </div>
    </form>
  );
}
