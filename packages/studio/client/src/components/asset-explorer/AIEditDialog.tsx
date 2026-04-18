import { Dialog, DialogContent, DialogHeader, DialogTitle, Button, Textarea } from "@vivd/ui";

import { Loader2, Wand2, Eraser } from "lucide-react";
import type { AssetItem } from "./types";
import { getStudioImageUrlCandidates } from "./utils";
import { FallbackImage } from "./FallbackImage";

interface AIEditDialogProps {
  open: boolean;
  editingImage: AssetItem | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
  projectSlug: string;
  version: number;
  generatedImage?: AssetItem | null;
  onAcceptGeneratedImage?: () => void;
  onRejectGeneratedImage?: () => void;
  onRemoveBackground?: () => void;
  isRemovingBackground?: boolean;
}

export function AIEditDialog({
  open,
  editingImage,
  prompt,
  onPromptChange,
  onClose,
  onSubmit,
  isPending,
  projectSlug,
  version,
  generatedImage,
  onAcceptGeneratedImage,
  onRejectGeneratedImage,
  onRemoveBackground,
  isRemovingBackground,
}: AIEditDialogProps) {
  const isProcessing = isPending || isRemovingBackground;
  const showGeneratedPreview = Boolean(generatedImage);

  const renderImagePreview = (item: AssetItem, heading: string) => (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {heading}
      </p>
      <div className="flex items-center justify-center rounded-lg bg-muted p-2">
        <FallbackImage
          srcs={getStudioImageUrlCandidates(projectSlug, version, item.path)}
          alt={item.name}
          className="max-h-56 max-w-full rounded object-contain"
        />
      </div>
      <p className="truncate text-xs text-muted-foreground" title={item.path}>
        {item.path}
      </p>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className={showGeneratedPreview ? "max-w-3xl" : "max-w-lg"}>
        <DialogHeader>
          <DialogTitle>Edit Image with AI</DialogTitle>
        </DialogHeader>
        {editingImage && (
          <div className="space-y-4">
            {showGeneratedPreview ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  {renderImagePreview(editingImage, "Current Image")}
                  {generatedImage ? renderImagePreview(generatedImage, "Edited Candidate") : null}
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  Review the edited image before replacing the current selection. You
                  can keep the original, accept this version, or generate another one.
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-lg bg-muted p-2">
                <FallbackImage
                  srcs={getStudioImageUrlCandidates(
                    projectSlug,
                    version,
                    editingImage.path,
                  )}
                  alt={editingImage.name}
                  className="max-h-48 max-w-full rounded object-contain"
                />
              </div>
            )}

            {/* Quick Actions */}
            {onRemoveBackground && !showGeneratedPreview && (
              <>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRemoveBackground}
                    disabled={isProcessing}
                    className="flex-1"
                  >
                    {isRemovingBackground ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Removing...
                      </>
                    ) : (
                      <>
                        <Eraser className="h-4 w-4 mr-2" />
                        Remove Background
                      </>
                    )}
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or describe a custom edit
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-2">
              {!onRemoveBackground && (
                <label className="text-sm font-medium">
                  {showGeneratedPreview
                    ? "Adjust the prompt if you want another version"
                    : "What would you like to change?"}
                </label>
              )}
              <Textarea
                placeholder="e.g., Make the background blue, add a sunset, remove the text..."
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                rows={3}
                disabled={isProcessing}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={showGeneratedPreview && onRejectGeneratedImage ? onRejectGeneratedImage : onClose}
                disabled={isProcessing}
              >
                {showGeneratedPreview ? "Keep original" : "Cancel"}
              </Button>
              {showGeneratedPreview && onAcceptGeneratedImage ? (
                <Button onClick={onAcceptGeneratedImage} disabled={isProcessing}>
                  Use edited image
                </Button>
              ) : null}
              <Button
                onClick={onSubmit}
                disabled={!prompt.trim() || isProcessing}
                variant={showGeneratedPreview ? "outline" : "default"}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    {showGeneratedPreview ? "Generate another" : "Generate"}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
