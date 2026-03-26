import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, ImagePlus } from "lucide-react";
import type { AssetItem } from "./types";
import { getStudioImageUrlCandidates } from "./utils";
import { ImageThumbnail } from "./ImageThumbnail";

interface CreateImageDialogProps {
  open: boolean;
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedReferenceImages: string[];
  onToggleReferenceImage: (path: string) => void;
  availableImages: AssetItem[];
  isLoadingImages: boolean;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
  projectSlug: string;
  version: number;
}

export function CreateImageDialog({
  open,
  prompt,
  onPromptChange,
  selectedReferenceImages,
  onToggleReferenceImage,
  availableImages,
  isLoadingImages,
  onClose,
  onSubmit,
  isPending,
  projectSlug,
  version,
}: CreateImageDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create New Image with AI</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 flex-1 overflow-hidden flex flex-col px-1">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Describe the image you want to create
            </label>
            <Textarea
              placeholder="e.g., A modern hero banner with abstract geometric shapes in blue and purple gradients..."
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              rows={3}
            />
          </div>

          {/* Reference Images Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Reference Images (optional)
              {selectedReferenceImages.length > 0 && (
                <span className="text-muted-foreground ml-2">
                  ({selectedReferenceImages.length} selected)
                </span>
              )}
            </label>
            <p className="text-xs text-muted-foreground">
              Select existing images to use as style or content references
            </p>
            <ScrollArea className="h-[400px] border rounded-lg p-2">
              {isLoadingImages ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : availableImages.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                  No images available in this project
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {availableImages.map((img) => (
                    <ImageThumbnail
                      key={img.path}
                      item={img}
                      imageUrls={getStudioImageUrlCandidates(
                        projectSlug,
                        version,
                        img.path,
                      )}
                      selected={selectedReferenceImages.includes(img.path)}
                      showSelection
                      onClick={() => onToggleReferenceImage(img.path)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={!prompt.trim() || isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4 mr-2" />
                  Create Image
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
