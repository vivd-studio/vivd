import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ChevronLeft,
  FileIcon,
  FolderOpen,
  ImagePlus,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { AssetItem } from "@/components/asset-explorer/types";
import { CreateImageDialog } from "@/components/asset-explorer/CreateImageDialog";
import { ImageThumbnail } from "@/components/asset-explorer/ImageThumbnail";
import { getStudioImageUrlCandidates } from "@/components/asset-explorer/utils";
import { uploadFilesToStudioPath } from "@/components/asset-explorer/upload";
import type { CmsFieldDefinition } from "@vivd/shared/cms";
import {
  buildStoredAssetReferencePath,
  dirnamePosix,
  isPathInsideRoot,
  normalizePosix,
  titleizeKey,
  type CmsAssetStorageKind,
} from "./helpers";

interface CmsAssetPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  version: number;
  field: CmsFieldDefinition;
  entryRelativePath: string;
  currentValue: string;
  storageKind: CmsAssetStorageKind;
  assetRootPath: string;
  defaultFolderPath: string;
  canUseAiImages: boolean;
  onSelect: (storedReference: string) => void;
}

function fieldAcceptsImages(field: CmsFieldDefinition, currentValue: string): boolean {
  return (
    (field.accepts ?? []).some((accept) => accept.startsWith("image/")) ||
    /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(currentValue)
  );
}

function matchesAcceptPattern(item: AssetItem, accepts: string[]): boolean {
  if (item.type === "folder" || accepts.length === 0) {
    return true;
  }

  const lowerName = item.name.toLowerCase();
  return accepts.some((accept) => {
    const normalizedAccept = accept.toLowerCase();
    if (normalizedAccept === "image/*") {
      return Boolean(item.isImage);
    }
    if (normalizedAccept.endsWith("/*")) {
      const prefix = normalizedAccept.slice(0, normalizedAccept.length - 1);
      return typeof item.mimeType === "string" && item.mimeType.toLowerCase().startsWith(prefix);
    }
    if (normalizedAccept.startsWith(".")) {
      return lowerName.endsWith(normalizedAccept);
    }
    return typeof item.mimeType === "string" && item.mimeType.toLowerCase() === normalizedAccept;
  });
}

function buildRelativeFolderLabel(
  rootPath: string,
  currentPath: string,
  rootLabel: string,
): string {
  if (currentPath === rootPath) {
    return rootLabel;
  }

  const normalizedRoot = normalizePosix(rootPath).replace(/\/+$/, "");
  const normalizedCurrent = normalizePosix(currentPath).replace(/\/+$/, "");
  const relative = normalizedCurrent.startsWith(`${normalizedRoot}/`)
    ? normalizedCurrent.slice(normalizedRoot.length + 1)
    : normalizedCurrent;

  return relative || rootLabel;
}

export function CmsAssetPickerSheet({
  open,
  onOpenChange,
  projectSlug,
  version,
  field,
  entryRelativePath,
  currentValue,
  storageKind,
  assetRootPath,
  defaultFolderPath,
  canUseAiImages,
  onSelect,
}: CmsAssetPickerSheetProps) {
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentPath, setCurrentPath] = useState(defaultFolderPath);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [createImageOpen, setCreateImageOpen] = useState(false);
  const [createImagePrompt, setCreateImagePrompt] = useState("");
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<string[]>([]);

  const accepts = field.accepts ?? [];
  const imageMode = fieldAcceptsImages(field, currentValue);
  const acceptAttribute = accepts.length > 0 ? accepts.join(",") : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialPath =
      currentValue &&
      isPathInsideRoot(currentValue, assetRootPath) &&
      currentValue.trim().length > 0
        ? dirnamePosix(currentValue)
        : defaultFolderPath;

    setCurrentPath(initialPath || assetRootPath);
  }, [assetRootPath, currentValue, defaultFolderPath, open]);

  const assetsQuery = trpc.assets.listAssets.useQuery(
    {
      slug: projectSlug,
      version,
      relativePath: currentPath,
    },
    { enabled: open, staleTime: 0 },
  );

  const createImageMutation = trpc.assets.createImageWithAI.useMutation({
    onSuccess: async (data) => {
      await utils.assets.invalidate();
      onSelect(buildStoredAssetReferencePath(entryRelativePath, data.path));
      toast.success("Image generated");
      setCreateImageOpen(false);
      setCreateImagePrompt("");
      setSelectedReferenceImages([]);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Failed to create image", { description: error.message });
    },
  });

  const availableItems = useMemo(
    () =>
      (assetsQuery.data?.items ?? []).filter((item) =>
        imageMode && accepts.length === 0
          ? item.type === "folder" || Boolean(item.isImage)
          : matchesAcceptPattern(item, accepts),
      ),
    [accepts, assetsQuery.data?.items, imageMode],
  );

  const availableImages = useMemo(
    () => availableItems.filter((item) => item.type === "file" && item.isImage),
    [availableItems],
  );

  const canNavigateUp = currentPath !== assetRootPath;
  const relativeFolderLabel = buildRelativeFolderLabel(
    assetRootPath,
    currentPath,
    storageKind === "public"
      ? assetRootPath.slice("public/".length) || "public"
      : "media",
  );

  const handleSelectAsset = useCallback(
    (item: AssetItem) => {
      if (item.type === "folder") {
        setCurrentPath(item.path);
        return;
      }

      onSelect(buildStoredAssetReferencePath(entryRelativePath, item.path));
      onOpenChange(false);
    },
    [entryRelativePath, onOpenChange, onSelect],
  );

  const handleNavigateUp = useCallback(() => {
    if (!canNavigateUp) {
      return;
    }

    const parentPath = dirnamePosix(currentPath) || assetRootPath;
    setCurrentPath(isPathInsideRoot(parentPath, assetRootPath) ? parentPath : assetRootPath);
  }, [assetRootPath, canNavigateUp, currentPath]);

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const normalizedFiles = Array.from(files);
      if (normalizedFiles.length === 0) {
        return;
      }

      setIsUploading(true);
      try {
        const uploadedPaths = await uploadFilesToStudioPath({
          projectSlug,
          version,
          targetPath: currentPath,
          files: normalizedFiles,
        });

        await utils.assets.invalidate();
        const firstUploadedPath = uploadedPaths[0];
        if (firstUploadedPath) {
          onSelect(buildStoredAssetReferencePath(entryRelativePath, firstUploadedPath));
          toast.success("Asset uploaded");
          onOpenChange(false);
        }
      } catch (error) {
        toast.error("Upload failed", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsUploading(false);
      }
    },
    [currentPath, entryRelativePath, onOpenChange, onSelect, projectSlug, utils.assets, version],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      const isExternalFileDrop =
        event.dataTransfer.types.includes("Files") &&
        !event.dataTransfer.types.includes("application/x-file-path");
      if (!isExternalFileDrop) {
        return;
      }

      event.preventDefault();
      setIsDragging(false);
      await handleUpload(event.dataTransfer.files);
    },
    [handleUpload],
  );

  const handleCreateImage = useCallback(() => {
    if (!createImagePrompt.trim()) {
      return;
    }

    createImageMutation.mutate({
      slug: projectSlug,
      version,
      prompt: createImagePrompt.trim(),
      referenceImages: selectedReferenceImages,
      targetPath: currentPath,
    });
  }, [
    createImageMutation,
    createImagePrompt,
    currentPath,
    projectSlug,
    selectedReferenceImages,
    version,
  ]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[560px] sm:max-w-[560px]">
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="space-y-1 pr-8">
              <SheetTitle>{imageMode ? "Choose image" : "Choose asset"}</SheetTitle>
              <SheetDescription>
                Browse files under <code>{`${assetRootPath}/`}</code>. Selecting a file writes{" "}
                {storageKind === "public"
                  ? "a site-root path like "
                  : "a relative reference like "}
                <code>
                  {storageKind === "public"
                    ? "/pdfs/products/example.pdf"
                    : "../../../media/products/example.pdf"}
                </code>{" "}
                into the entry YAML.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current folder
                </p>
                <p className="truncate text-sm font-medium">{relativeFolderLabel}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canNavigateUp}
                  onClick={handleNavigateUp}
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Up
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Upload
                </Button>
                {imageMode && canUseAiImages ? (
                  <Button variant="outline" size="sm" onClick={() => setCreateImageOpen(true)}>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    Generate
                  </Button>
                ) : null}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttribute}
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) {
                  void handleUpload(event.target.files);
                }
                event.target.value = "";
              }}
            />

            <div
              className={`mt-4 flex min-h-0 flex-1 flex-col rounded-xl border ${
                isDragging ? "border-primary bg-primary/5" : "border-border/60"
              }`}
              onDragOver={(event) => {
                const isExternalFileDrag =
                  event.dataTransfer.types.includes("Files") &&
                  !event.dataTransfer.types.includes("application/x-file-path");
                if (!isExternalFileDrag) {
                  return;
                }
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(event) => {
                void handleDrop(event);
              }}
            >
              <div className="border-b px-4 py-3 text-xs text-muted-foreground">
                Drop a file here to upload it directly into this folder.
              </div>
              <ScrollArea className="flex-1">
                {assetsQuery.isLoading ? (
                  <div className="flex h-40 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : availableItems.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                    <FolderOpen className="h-5 w-5" />
                    <p>No matching files in this folder yet.</p>
                    <p className="text-xs">
                      Upload a file or {imageMode ? "generate an image" : "choose another folder"}.
                    </p>
                  </div>
                ) : imageMode ? (
                  <div className="grid grid-cols-2 gap-3 p-4">
                    {availableItems.map((item) =>
                      item.type === "folder" ? (
                        <button
                          key={item.path}
                          type="button"
                          className="flex min-h-28 flex-col items-start justify-between rounded-lg border border-border/60 bg-muted/20 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                          onClick={() => handleSelectAsset(item)}
                        >
                          <FolderOpen className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{titleizeKey(item.name)}</p>
                            <p className="text-xs text-muted-foreground">{item.name}</p>
                          </div>
                        </button>
                      ) : (
                        <ImageThumbnail
                          key={item.path}
                          item={item}
                          imageUrls={getStudioImageUrlCandidates(projectSlug, version, item.path)}
                          selected={currentValue === item.path}
                          showSelection
                          draggable={false}
                          onClick={() => handleSelectAsset(item)}
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 p-4">
                    {availableItems.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg border border-border/60 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                        onClick={() => handleSelectAsset(item)}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {item.type === "folder" ? (
                            <FolderOpen className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileIcon className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{item.path}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {imageMode ? (
        <CreateImageDialog
          open={createImageOpen}
          prompt={createImagePrompt}
          onPromptChange={setCreateImagePrompt}
          selectedReferenceImages={selectedReferenceImages}
          onToggleReferenceImage={(path) =>
            setSelectedReferenceImages((current) =>
              current.includes(path)
                ? current.filter((value) => value !== path)
                : [...current, path],
            )
          }
          availableImages={availableImages}
          isLoadingImages={assetsQuery.isLoading}
          onClose={() => {
            setCreateImageOpen(false);
            setCreateImagePrompt("");
            setSelectedReferenceImages([]);
          }}
          onSubmit={handleCreateImage}
          isPending={createImageMutation.isPending}
          projectSlug={projectSlug}
          version={version}
        />
      ) : null}
    </>
  );
}
