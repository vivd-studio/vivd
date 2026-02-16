import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Download,
  ExternalLink,
  FileText,
  MessageSquarePlus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { buildImageUrl } from "./utils";
import { useOptionalChatContext } from "@/components/chat/ChatContext";

interface PdfViewerPanelProps {
  projectSlug: string;
  version: number;
  filePath: string;
  onClose: () => void;
  onDelete?: () => void;
}

export function PdfViewerPanel({
  projectSlug,
  version,
  filePath,
  onClose,
  onDelete,
}: PdfViewerPanelProps) {
  const pdfUrl = buildImageUrl(projectSlug, version, filePath);
  const filename = filePath.split("/").pop() || filePath;
  const chatContext = useOptionalChatContext();

  const handleAddToChat = useCallback(() => {
    if (!chatContext) return;
    chatContext.addAttachedFile({
      path: filePath,
      filename,
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    });
    toast.success(`Added ${filename} to chat`);
  }, [chatContext, filePath, filename]);

  const handleDownload = useCallback(() => {
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [pdfUrl, filename]);

  const handleOpenExternal = useCallback(() => {
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }, [pdfUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-10 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold truncate" title={filename}>
              {filename}
            </h2>
            <p
              className="text-xs text-muted-foreground truncate"
              title={filePath}
            >
              {filePath}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                className="h-8 w-8 p-0"
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenExternal}
                className="h-8 w-8 p-0"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in new tab</TooltipContent>
          </Tooltip>

          {chatContext && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddToChat}
                  className="h-8 w-8 p-0"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add to Chat</TooltipContent>
            </Tooltip>
          )}

          {onDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* PDF display */}
      <div className="flex-1 overflow-hidden bg-muted/10">
        <iframe
          src={pdfUrl}
          title={filename}
          className="w-full h-full border-0 bg-background"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <span>Press Escape to close</span>
      </div>
    </div>
  );
}

