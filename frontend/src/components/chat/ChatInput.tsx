import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ElementSelector } from "./ElementSelector";
import { SelectedElementPill } from "./SelectedElementPill";
import { ImagePreviewPill } from "./ImagePreviewPill";
import { useChatContext } from "./ChatContext";

export function ChatInput() {
  const {
    input,
    setInput,
    handleSend,
    attachedElement,
    setAttachedElement,
    attachedImages,
    addAttachedImages,
    removeAttachedImage,
    selectorMode,
    setSelectorMode,
    isLoading,
    isUsageBlocked,
  } = useChatContext();

  // Combine loading and blocked states for disabling
  const isDisabled = isLoading || isUsageBlocked;

  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));

      if (imageFiles.length > 0) {
        const newImages = imageFiles.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
          tempId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        addAttachedImages(newImages);
      }
    },
    [addAttachedImages]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      if (imageItems.length > 0) {
        e.preventDefault();
        const newImages = imageItems
          .map((item) => {
            const file = item.getAsFile();
            if (!file) return null;
            return {
              file,
              previewUrl: URL.createObjectURL(file),
              tempId: `${Date.now()}-${Math.random()
                .toString(36)
                .substr(2, 9)}`,
            };
          })
          .filter(Boolean) as {
          file: File;
          previewUrl: string;
          tempId: string;
        }[];

        if (newImages.length > 0) {
          addAttachedImages(newImages);
        }
      }
    },
    [addAttachedImages]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));

      if (imageFiles.length > 0) {
        const newImages = imageFiles.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
          tempId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        addAttachedImages(newImages);
      }

      // Reset input to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [addAttachedImages]
  );

  return (
    <div
      className={`p-4 border-t mt-auto transition-colors ${
        isDragOver ? "bg-primary/5 border-primary border-dashed" : ""
      }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Show attached element pill above input */}
      {attachedElement && (
        <div className="mb-2">
          <SelectedElementPill
            selector={attachedElement.selector}
            description={attachedElement.description}
            onRemove={() => setAttachedElement(null)}
          />
        </div>
      )}

      {/* Show attached image previews above input */}
      {attachedImages.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachedImages.map((img) => (
            <ImagePreviewPill
              key={img.tempId}
              previewUrl={img.previewUrl}
              fileName={img.file.name}
              onRemove={() => removeAttachedImage(img.tempId)}
            />
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        {/* Upload button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled}
          className="h-10 w-10 text-muted-foreground hover:text-foreground"
          title="Upload image"
        >
          <Plus className="w-5 h-5" />
        </Button>
        {setSelectorMode && (
          <ElementSelector
            isActive={selectorMode}
            onToggle={() => setSelectorMode(!selectorMode)}
            disabled={isDisabled}
          />
        )}
        <div className="flex-1 flex gap-2 items-end">
          <textarea
            className={`flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none max-h-[200px] ${
              isDragOver ? "border-primary" : ""
            } ${isUsageBlocked ? "border-destructive/50" : ""}`}
            placeholder={
              isUsageBlocked
                ? "Usage limit reached. Please wait for the limit to reset."
                : selectorMode
                ? "Click an element in the preview..."
                : attachedElement || attachedImages.length > 0
                ? "Describe what you want to change..."
                : "Type a task or drop an image..."
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isUsageBlocked) {
                  handleSend();
                }
              }
            }}
            onPaste={handlePaste}
            disabled={isDisabled}
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={
              isDisabled ||
              (!input.trim() && !attachedElement && attachedImages.length === 0)
            }
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}
