import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Wand2, Eraser } from "lucide-react";
import type { AssetItem } from "./types";
import { buildImageUrl } from "./utils";

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
  onRemoveBackground,
  isRemovingBackground,
}: AIEditDialogProps) {
  const isProcessing = isPending || isRemovingBackground;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Image with AI</DialogTitle>
        </DialogHeader>
        {editingImage && (
          <div className="space-y-4">
            <div className="flex items-center justify-center bg-muted rounded-lg p-2">
              <img
                src={buildImageUrl(projectSlug, version, editingImage.path)}
                alt={editingImage.name}
                className="max-w-full max-h-48 object-contain rounded"
              />
            </div>

            {/* Quick Actions */}
            {onRemoveBackground && (
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
                  What would you like to change?
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
              <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
                Cancel
              </Button>
              <Button
                onClick={onSubmit}
                disabled={!prompt.trim() || isProcessing}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Generate
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
