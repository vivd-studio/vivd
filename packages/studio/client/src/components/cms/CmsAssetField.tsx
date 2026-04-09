import { useMemo, useState } from "react";
import { Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FallbackImage } from "@/components/asset-explorer/FallbackImage";
import { AIEditDialog } from "@/components/asset-explorer/AIEditDialog";
import { getStudioImageUrlCandidates } from "@/components/asset-explorer/utils";
import type { CmsFieldDefinition } from "@vivd/shared/cms";
import { CmsAssetPickerSheet } from "./CmsAssetPickerSheet";
import {
  buildRelativeReferencePath,
  getAssetPathValue,
  isPathInsideRoot,
  resolveRelativePath,
  setAssetPathValue,
} from "./helpers";

interface CmsAssetFieldProps {
  projectSlug: string;
  version: number;
  fieldId: string;
  label: string;
  field: CmsFieldDefinition;
  value: unknown;
  entryRelativePath: string;
  mediaRootPath: string;
  defaultFolderPath: string;
  canUseAiImages: boolean;
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
  mediaRootPath,
  defaultFolderPath,
  canUseAiImages,
  compact = false,
  onChange,
  onOpenAsset,
}: CmsAssetFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  const assetPath = getAssetPathValue(value);
  const resolvedAssetPath = assetPath
    ? resolveRelativePath(entryRelativePath, assetPath)
    : "";
  const canPreviewAsset = Boolean(
    resolvedAssetPath && isPathInsideRoot(resolvedAssetPath, mediaRootPath),
  );
  const imageMode = fieldAcceptsImages(field, assetPath);
  const currentIsImage =
    imageMode && /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(resolvedAssetPath);

  const imageUrls = useMemo(
    () =>
      resolvedAssetPath
        ? getStudioImageUrlCandidates(projectSlug, version, resolvedAssetPath)
        : [],
    [projectSlug, resolvedAssetPath, version],
  );

  const editImageMutation = trpc.assets.editImageWithAI.useMutation({
    onSuccess: (data) => {
      onChange(setAssetPathValue(value, buildRelativeReferencePath(entryRelativePath, data.newPath)));
      toast.success("Image updated");
      setAiPrompt("");
      setAiEditOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to edit image", { description: error.message });
    },
  });

  return (
    <>
      <div
        className={`space-y-3 rounded-lg border border-border/60 ${
          compact ? "p-3" : "p-4"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor={fieldId}>{label}</Label>
            {!compact ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {field.description?.trim() ||
                  "Store a path under src/content/media/ and pick from the media library."}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              {compact ? "Choose" : assetPath ? "Replace" : imageMode ? "Choose image" : "Choose file"}
            </Button>
            {assetPath.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenAsset(assetPath)}
              >
                Open
              </Button>
            ) : null}
            {currentIsImage && canPreviewAsset && canUseAiImages ? (
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
            {assetPath.trim() ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(setAssetPathValue(value, ""))}
              >
                <X className="mr-2 h-4 w-4" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {currentIsImage && canPreviewAsset ? (
          <div className="flex gap-3 rounded-xl border border-border/50 bg-muted/20 p-3">
            <button
              type="button"
              className="overflow-hidden rounded-lg border border-border/60 bg-background"
              onClick={() => onOpenAsset(assetPath)}
            >
              <FallbackImage
                srcs={imageUrls}
                alt={assetPath || label}
                className={`block object-cover ${compact ? "h-20 w-28" : "h-24 w-36"}`}
                fallback={
                  <div
                    className={`flex items-center justify-center text-xs text-muted-foreground ${
                      compact ? "h-20 w-28" : "h-24 w-36"
                    }`}
                  >
                    Preview unavailable
                  </div>
                }
              />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {resolvedAssetPath.split("/").pop() || assetPath}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{assetPath}</p>
            </div>
          </div>
        ) : assetPath.trim() ? (
          <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
            <p className="truncate text-sm font-medium">
              {resolvedAssetPath.split("/").pop() || assetPath}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{assetPath}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-5 text-sm text-muted-foreground">
            {imageMode
              ? "No image selected yet. Choose, upload, or generate one."
              : "No asset selected yet. Choose or upload a file."}
          </div>
        )}

        <Input
          id={fieldId}
          value={assetPath}
          placeholder={imageMode ? "../../../media/products/item/hero.webp" : "../../../media/files/brochure.pdf"}
          onChange={(event) => onChange(setAssetPathValue(value, event.target.value))}
        />
      </div>

      <CmsAssetPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectSlug={projectSlug}
        version={version}
        field={field}
        entryRelativePath={entryRelativePath}
        currentValue={resolvedAssetPath}
        mediaRootPath={mediaRootPath}
        defaultFolderPath={defaultFolderPath}
        canUseAiImages={canUseAiImages}
        onSelect={(relativePath) => onChange(setAssetPathValue(value, relativePath))}
      />

      {currentIsImage && canPreviewAsset ? (
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
          onClose={() => {
            setAiEditOpen(false);
            setAiPrompt("");
          }}
          onSubmit={() => {
            if (!resolvedAssetPath || !aiPrompt.trim()) {
              return;
            }
            editImageMutation.mutate({
              slug: projectSlug,
              version,
              relativePath: resolvedAssetPath,
              prompt: aiPrompt.trim(),
            });
          }}
          isPending={editImageMutation.isPending}
          projectSlug={projectSlug}
          version={version}
        />
      ) : null}
    </>
  );
}
