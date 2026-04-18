import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "@vivd/ui";

import { Download, Trash2, Wand2 } from "lucide-react";
import type { AssetItem } from "./types";
import { FallbackImage } from "./FallbackImage";

interface ImagePreviewDialogProps {
  open: boolean;
  imageUrl: string | null;
  imageItem: AssetItem | null;
  onClose: () => void;
  onAiEdit?: () => void;
  onDelete: () => void;
  onDownload: () => void;
}

export function ImagePreviewDialog({
  open,
  imageUrl,
  imageItem,
  onClose,
  onAiEdit,
  onDelete,
  onDownload,
}: ImagePreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="flex-1">
            {imageItem?.name || "Image Preview"}
          </DialogTitle>
          {imageItem && (
            <div className="flex gap-2 mr-8">
              <Button
                variant="secondary"
                size="sm"
                onClick={onDownload}
                title="Download file"
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              {onAiEdit && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onAiEdit}
                  title="Edit with AI"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  AI Edit
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                title="Delete image"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
          )}
        </DialogHeader>
        {imageUrl && (
          <div className="flex items-center justify-center p-4">
            <FallbackImage
              srcs={imageUrl ? [imageUrl] : []}
              alt="Preview"
              className="max-w-full max-h-[70vh] object-contain rounded"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
