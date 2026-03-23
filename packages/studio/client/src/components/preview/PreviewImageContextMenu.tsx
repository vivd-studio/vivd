import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOptionalChatContext } from "@/components/chat/ChatContext";
import { buildImageUrl } from "../asset-explorer/utils";
import type { FileTreeNode } from "../asset-explorer/types";
import { usePreview } from "./PreviewContext";
import { Download, MessageSquarePlus, Trash2, Wand2 } from "lucide-react";

interface PreviewImageContextMenuProps {
  open: boolean;
  projectSlug: string;
  version: number;
  asset: FileTreeNode | null;
  position: { x: number; y: number } | null;
  canUseAiImages: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PreviewImageContextMenu({
  open,
  projectSlug,
  version,
  asset,
  position,
  canUseAiImages,
  onOpenChange,
}: PreviewImageContextMenuProps) {
  const chatContext = useOptionalChatContext();
  const { setEditingAsset, setPendingDeleteAsset } = usePreview();

  if (!asset || !position) return null;

  const closeMenu = () => onOpenChange(false);

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = buildImageUrl(projectSlug, version, asset.path);
    link.download = asset.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    closeMenu();
  };

  const handleAddToChat = () => {
    if (!chatContext) return;

    chatContext.addAttachedFile({
      path: asset.path,
      filename: asset.name,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    });
    toast.success(`Added ${asset.name} to chat`);
    closeMenu();
  };

  const handleAiEdit = () => {
    setEditingAsset(asset);
    closeMenu();
  };

  const handleDelete = () => {
    setPendingDeleteAsset(asset);
    closeMenu();
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden="true"
          className="pointer-events-none fixed h-0 w-0"
          tabIndex={-1}
          style={{ left: position.x, top: position.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="w-48"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download
        </DropdownMenuItem>
        {chatContext && (
          <DropdownMenuItem onClick={handleAddToChat}>
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            Add to Chat
          </DropdownMenuItem>
        )}
        {canUseAiImages && asset.isImage && (
          <DropdownMenuItem onClick={handleAiEdit}>
            <Wand2 className="mr-2 h-4 w-4" />
            AI Edit
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
