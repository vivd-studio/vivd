import { useCallback, useMemo, useRef, useState } from "react";
import {
  Download,
  Loader2,
  MessageSquarePlus,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useOptionalChatContext } from "@/components/chat/ChatContext";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FallbackImage } from "@/components/asset-explorer/FallbackImage";
import { AIEditDialog } from "@/components/asset-explorer/AIEditDialog";
import {
  buildAssetFileUrl,
  getStudioImageUrlCandidates,
} from "@/components/asset-explorer/utils";
import type { AssetItem } from "@/components/asset-explorer/types";
import { uploadFilesToStudioPath } from "@/components/asset-explorer/upload";
import type { CmsFieldDefinition } from "@vivd/shared/cms";
import { cn } from "@/lib/utils";
import { CmsAssetPickerSheet } from "./CmsAssetPickerSheet";
import {
  buildStoredAssetReferencePath,
  dirnamePosix,
  getAssetPathValue,
  isPathInsideRoot,
  resolveAssetReferencePath,
  setAssetPathValue,
  type CmsAssetStorageKind,
} from "./helpers";

interface CmsAssetFieldProps {
  projectSlug: string;
  version: number;
  fieldId: string;
  label: string;
  field: CmsFieldDefinition;
  value: unknown;
  entryRelativePath: string;
  storageKind: CmsAssetStorageKind;
  assetRootPath: string;
  defaultFolderPath: string;
  canUseAiImages: boolean;
  readOnly?: boolean;
  compact?: boolean;
  onChange: (nextValue: unknown) => void;
  onOpenAsset: (assetPath: string) => void;
}

function fieldAcceptsImages(field: CmsFieldDefinition, assetPath: string): boolean {
  return (
    (field.accepts ?? []).some((accept) => accept.startsWith("image/")) ||
    /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(assetPath)
  );
}

export function CmsAssetField({
  projectSlug,
  version,
  fieldId,
  label,
  field,
  value,
  entryRelativePath,
  storageKind,
  assetRootPath,
  defaultFolderPath,
  canUseAiImages,
  readOnly = false,
  compact = false,
  onChange,
  onOpenAsset,
}: CmsAssetFieldProps) {
  const utils = trpc.useUtils();
  const chatContext = useOptionalChatContext();
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiCandidatePath, setAiCandidatePath] = useState<string | null>(null);
  const [isReplacingFile, setIsReplacingFile] = useState(false);

  const assetPath = getAssetPathValue(value);
  const resolvedAssetPath = assetPath
    ? resolveAssetReferencePath(entryRelativePath, assetPath)
    : "";
  const hasAsset = assetPath.trim().length > 0;
  const acceptAttribute =
    (field.accepts ?? []).length > 0 ? (field.accepts ?? []).join(",") : undefined;
  const canManageCurrentAsset = Boolean(
    resolvedAssetPath && isPathInsideRoot(resolvedAssetPath, assetRootPath),
  );
  const canPreviewAsset = Boolean(canManageCurrentAsset);
  const imageMode = fieldAcceptsImages(field, assetPath);
  const currentIsImage =
    imageMode && /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(resolvedAssetPath);
  const assetFilename = resolvedAssetPath.split("/").pop() || assetPath || label;
  const generatedImageItem = useMemo<AssetItem | null>(
    () =>
      aiCandidatePath
        ? {
            name: aiCandidatePath.split("/").pop() || aiCandidatePath,
            type: "file",
            path: aiCandidatePath,
            isImage: true,
          }
        : null,
    [aiCandidatePath],
  );

  const imageUrls = useMemo(
    () =>
      resolvedAssetPath
        ? getStudioImageUrlCandidates(projectSlug, version, resolvedAssetPath)
        : [],
    [projectSlug, resolvedAssetPath, version],
  );

  const editImageMutation = trpc.assets.editImageWithAI.useMutation({
    onSuccess: async (data) => {
      await utils.assets.invalidate();
      setAiCandidatePath(data.newPath);
      toast.success("Edited image ready to review");
    },
    onError: (error) => {
      toast.error("Failed to edit image", { description: error.message });
    },
  });
  const deleteAssetMutation = trpc.assets.deleteAsset.useMutation();

  const handleDownload = useCallback(() => {
    if (!resolvedAssetPath) return;
    const link = document.createElement("a");
    link.href = buildAssetFileUrl(projectSlug, version, resolvedAssetPath);
    link.download = assetFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [assetFilename, projectSlug, resolvedAssetPath, version]);

  const handleAddToChat = useCallback(() => {
    if (!chatContext || !resolvedAssetPath) return;
    chatContext.addAttachedFile({
      path: resolvedAssetPath,
      filename: assetFilename,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    });
    toast.success(`Added ${assetFilename} to chat`);
  }, [assetFilename, chatContext, resolvedAssetPath]);

  const handleClear = useCallback(() => {
    onChange(setAssetPathValue(value, ""));
  }, [onChange, value]);

  const handleOverwriteFile = useCallback(
    async (files: FileList | File[]) => {
      if (!canManageCurrentAsset || !resolvedAssetPath) {
        return;
      }

      const normalizedFiles = Array.from(files);
      if (normalizedFiles.length === 0) {
        return;
      }

      const targetFilename = resolvedAssetPath.split("/").pop();
      if (!targetFilename) {
        toast.error("Replace failed", {
          description: "Could not determine the current filename.",
        });
        return;
      }

      setIsReplacingFile(true);
      try {
        await uploadFilesToStudioPath({
          projectSlug,
          version,
          targetPath: dirnamePosix(resolvedAssetPath),
          filename: targetFilename,
          files: normalizedFiles,
        });
        await utils.assets.invalidate();
        toast.success("File replaced");
      } catch (error) {
        toast.error("Replace failed", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsReplacingFile(false);
      }
    },
    [canManageCurrentAsset, projectSlug, resolvedAssetPath, utils.assets, version],
  );

  const handleDeleteCurrentFile = useCallback(async () => {
    if (!canManageCurrentAsset || !resolvedAssetPath) {
      return;
    }

    try {
      await deleteAssetMutation.mutateAsync({
        slug: projectSlug,
        version,
        relativePath: resolvedAssetPath,
      });
      await utils.assets.invalidate();
      onChange(setAssetPathValue(value, ""));
      setDeleteConfirmOpen(false);
      toast.success("File deleted");
    } catch (error) {
      toast.error("Delete failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    canManageCurrentAsset,
    deleteAssetMutation,
    onChange,
    projectSlug,
    resolvedAssetPath,
    utils.assets,
    value,
    version,
  ]);

  const discardAiCandidate = useCallback(
    async (options?: { closeDialog?: boolean; resetPrompt?: boolean; silent?: boolean }) => {
      const closeDialog = options?.closeDialog ?? true;
      const resetPrompt = options?.resetPrompt ?? true;
      const silent = options?.silent ?? false;

      if (aiCandidatePath) {
        try {
          await deleteAssetMutation.mutateAsync({
            slug: projectSlug,
            version,
            relativePath: aiCandidatePath,
          });
          await utils.assets.invalidate();
          if (!silent) {
            toast.info("Kept original image");
          }
        } catch (error) {
          toast.error("Failed to discard AI edit", {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      }

      setAiCandidatePath(null);
      if (resetPrompt) {
        setAiPrompt("");
      }
      if (closeDialog) {
        setAiEditOpen(false);
      }
    },
    [aiCandidatePath, deleteAssetMutation, projectSlug, utils.assets, version],
  );

  const handleAcceptAiEdit = useCallback(() => {
    if (!aiCandidatePath) return;
    onChange(
      setAssetPathValue(
        value,
        buildStoredAssetReferencePath(entryRelativePath, aiCandidatePath),
      ),
    );
    setAiCandidatePath(null);
    setAiPrompt("");
    setAiEditOpen(false);
    toast.success("Image updated");
  }, [aiCandidatePath, entryRelativePath, onChange, value]);

  const handleSubmitAiEdit = useCallback(async () => {
    if (!resolvedAssetPath || !aiPrompt.trim()) {
      return;
    }

    if (aiCandidatePath) {
      await discardAiCandidate({
        closeDialog: false,
        resetPrompt: false,
        silent: true,
      });
    }

    editImageMutation.mutate({
      slug: projectSlug,
      version,
      relativePath: resolvedAssetPath,
      prompt: aiPrompt.trim(),
    });
  }, [
    aiCandidatePath,
    aiPrompt,
    discardAiCandidate,
    editImageMutation,
    projectSlug,
    resolvedAssetPath,
    version,
  ]);

  const handleCloseAiEditDialog = useCallback(() => {
    void discardAiCandidate({ closeDialog: true, resetPrompt: true });
  }, [discardAiCandidate]);

  const openPreviewButton = hasAsset ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="relative z-10 shrink-0"
      onClick={() => onOpenAsset(assetPath)}
    >
      Open preview
    </Button>
  ) : null;

  const openReplaceUploadPicker = useCallback(() => {
    replaceFileInputRef.current?.click();
  }, []);

  const assetFooterClassName = cn(
    "flex flex-col gap-3 border-t border-border/50 bg-background/90 px-3 py-3",
    compact ? null : "sm:flex-row sm:items-end sm:justify-between",
  );

  const actionButtons = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        compact ? "w-full" : null,
      )}
    >
      {!readOnly ? (
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          {hasAsset ? "Choose other" : imageMode ? "Choose image" : "Choose file"}
        </Button>
      ) : null}
      {!readOnly && hasAsset && canManageCurrentAsset ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isReplacingFile || deleteAssetMutation.isPending}
          onClick={openReplaceUploadPicker}
        >
          {isReplacingFile ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Overwrite file
        </Button>
      ) : null}
      {!readOnly && currentIsImage && canPreviewAsset && canUseAiImages ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAiEditOpen(true)}
        >
          <Wand2 className="mr-2 h-4 w-4" />
          AI Edit
        </Button>
      ) : null}
      {!readOnly && hasAsset ? (
        <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
          <X className="mr-2 h-4 w-4" />
          Clear link
        </Button>
      ) : null}
      {!readOnly && hasAsset && canManageCurrentAsset ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={deleteAssetMutation.isPending || isReplacingFile}
          onClick={() => setDeleteConfirmOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete file
        </Button>
      ) : null}
    </div>
  );

  const pathInput = (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Path
        </p>
        {hasAsset ? (
          <p className="truncate text-[11px] text-muted-foreground">
            {storageKind === "public" ? "Public site path" : "Relative media reference"}
          </p>
        ) : null}
      </div>
      <Input
        id={fieldId}
        value={assetPath}
        className={`${compact ? "h-8" : "h-9"} border-border/50 bg-background text-xs text-foreground/80`}
        placeholder={
          imageMode
            ? storageKind === "public"
              ? "/images/products/item/hero.webp"
              : "../../../media/products/item/hero.webp"
            : storageKind === "public"
              ? "/pdfs/products/item/brochure.pdf"
              : "../../../media/files/brochure.pdf"
        }
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(event) => onChange(setAssetPathValue(value, event.target.value))}
      />
    </div>
  );

  const selectedAssetCard = hasAsset ? (
    <div className="space-y-3">
      {currentIsImage && canPreviewAsset ? (
        <ContextMenu>
          <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/15">
            <ContextMenuTrigger asChild>
              <div className="flex flex-col gap-3 p-3 sm:flex-row">
                <button
                  type="button"
                  className="overflow-hidden rounded-lg border border-border/60 bg-background transition-colors hover:border-border"
                  onClick={() => onOpenAsset(assetPath)}
                >
                  <FallbackImage
                    srcs={imageUrls}
                    alt={assetPath || label}
                    className={`block object-cover ${compact ? "h-20 w-28" : "h-28 w-40"}`}
                    fallback={
                      <div
                        className={`flex items-center justify-center text-xs text-muted-foreground ${
                          compact ? "h-20 w-28" : "h-28 w-40"
                        }`}
                      >
                        Preview unavailable
                      </div>
                    }
                  />
                </button>
                <div className="min-w-0 flex-1 py-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium" title={assetFilename}>
                        {assetFilename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {storageKind === "public" ? "Public image" : "Media library image"}
                      </p>
                    </div>
                    {openPreviewButton}
                  </div>
                </div>
              </div>
            </ContextMenuTrigger>
            <div
              data-testid={`${fieldId}-asset-footer`}
              className={assetFooterClassName}
            >
              {pathInput}
              <div
                data-testid={`${fieldId}-asset-actions`}
                className={compact ? "min-w-0 w-full" : "shrink-0"}
              >
                {actionButtons}
              </div>
            </div>
          </div>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onClick={() => onOpenAsset(assetPath)}>
              Open preview
            </ContextMenuItem>
            <ContextMenuItem onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </ContextMenuItem>
            {!readOnly && hasAsset && canManageCurrentAsset ? (
              <ContextMenuItem onClick={openReplaceUploadPicker}>
                <Upload className="mr-2 h-4 w-4" />
                Overwrite file
              </ContextMenuItem>
            ) : null}
            {chatContext ? (
              <ContextMenuItem onClick={handleAddToChat}>
                <MessageSquarePlus className="mr-2 h-4 w-4" />
                Add to Chat
              </ContextMenuItem>
            ) : null}
            {!readOnly && canUseAiImages ? (
              <ContextMenuItem onClick={() => setAiEditOpen(true)}>
                <Wand2 className="mr-2 h-4 w-4" />
                AI Edit
              </ContextMenuItem>
            ) : null}
            {!readOnly ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => setPickerOpen(true)}>
                  Choose other file
                </ContextMenuItem>
                {hasAsset && canManageCurrentAsset ? (
                  <ContextMenuItem
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete file
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem
                  onClick={handleClear}
                  className="text-destructive focus:text-destructive"
                >
                  <X className="mr-2 h-4 w-4" />
                  Clear link
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/15">
          <div className="flex flex-wrap items-start justify-between gap-3 p-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium" title={assetFilename}>
                {assetFilename}
              </p>
              <p className="text-xs text-muted-foreground">
                {storageKind === "public" ? "Linked public asset" : "Linked media asset"}
              </p>
            </div>
            {openPreviewButton}
          </div>
          <div
            data-testid={`${fieldId}-asset-footer`}
            className={assetFooterClassName}
          >
            {pathInput}
            <div
              data-testid={`${fieldId}-asset-actions`}
              className={compact ? "min-w-0 w-full" : "shrink-0"}
            >
              {actionButtons}
            </div>
          </div>
        </div>
      )}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-border/60 px-4 py-5 text-sm text-muted-foreground">
      <p>
        {imageMode
          ? storageKind === "public"
            ? "Choose an image from the public files, upload one, or generate a new one."
            : "Choose an image from the media library, upload one, or generate a new one."
          : storageKind === "public"
            ? "Choose a file from the public files or upload a new one."
            : "Choose a file from the media library or upload a new one."}
      </p>
      <div
        data-testid={`${fieldId}-asset-footer`}
        className={cn("mt-4 flex flex-col gap-3", compact ? null : "sm:flex-row sm:items-end sm:justify-between")}
      >
        {pathInput}
        <div
          data-testid={`${fieldId}-asset-actions`}
          className={compact ? "min-w-0 w-full" : "shrink-0"}
        >
          {actionButtons}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        className={`space-y-3 rounded-lg border border-border/60 ${
          compact ? "p-3" : "p-4"
        }`}
      >
        {!readOnly ? (
          <input
            ref={replaceFileInputRef}
            id={`${fieldId}-replace-upload`}
            type="file"
            accept={acceptAttribute}
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) {
                void handleOverwriteFile(event.target.files);
              }
              event.target.value = "";
            }}
          />
        ) : null}
        <div className="space-y-1">
          <div>
            <Label htmlFor={fieldId}>{label}</Label>
            {!compact ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {field.description?.trim() ||
                  (imageMode
                    ? storageKind === "public"
                      ? "Choose an image from the public files for this entry."
                      : "Choose an image from the media library for this entry."
                    : storageKind === "public"
                      ? "Choose a file from the public files for this entry."
                      : "Choose a file from the media library for this entry.")}
              </p>
            ) : null}
          </div>
        </div>

        {selectedAssetCard}
      </div>

      {!readOnly ? (
        <CmsAssetPickerSheet
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          projectSlug={projectSlug}
          version={version}
          field={field}
          entryRelativePath={entryRelativePath}
          currentValue={resolvedAssetPath}
          storageKind={storageKind}
          assetRootPath={assetRootPath}
          defaultFolderPath={defaultFolderPath}
          canUseAiImages={canUseAiImages}
          onSelect={(storedReference) => onChange(setAssetPathValue(value, storedReference))}
          onDeleteCurrentAsset={() => onChange(setAssetPathValue(value, ""))}
        />
      ) : null}

      {!readOnly && currentIsImage && canPreviewAsset ? (
        <AIEditDialog
          open={aiEditOpen}
          editingImage={
            resolvedAssetPath
              ? {
                  name: resolvedAssetPath.split("/").pop() || resolvedAssetPath,
                  type: "file",
                  path: resolvedAssetPath,
                  isImage: true,
                }
              : null
          }
          prompt={aiPrompt}
          onPromptChange={setAiPrompt}
          onClose={handleCloseAiEditDialog}
          onSubmit={() => {
            void handleSubmitAiEdit();
          }}
          isPending={editImageMutation.isPending || deleteAssetMutation.isPending}
          projectSlug={projectSlug}
          version={version}
          generatedImage={generatedImageItem}
          onAcceptGeneratedImage={handleAcceptAiEdit}
          onRejectGeneratedImage={() => {
            void discardAiCandidate({ closeDialog: true, resetPrompt: true });
          }}
        />
      ) : null}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete linked file?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <code>{resolvedAssetPath}</code> from the project and clears this field.
              If other entries link to the same path, they will lose the file too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAssetMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteAssetMutation.isPending}
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteCurrentFile();
              }}
            >
              {deleteAssetMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
