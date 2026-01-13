import {
  MousePointerClick,
  Sparkles,
  Palette,
  Type,
  Send,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectedElementPill } from "./SelectedElementPill";
import { ImagePreviewPill } from "./ImagePreviewPill";
import { useEffect, useRef, useState, useCallback } from "react";
import type { AttachedImage } from "./ChatContext";

interface EmptyStatePromptProps {
  onSuggestionClick?: (suggestion: string) => void;
  onEnterSelectorMode?: () => void;
  selectorModeAvailable?: boolean;
  selectorMode?: boolean;
  // Input props for integrated textarea
  input?: string;
  setInput?: (value: string) => void;
  onSend?: () => void;
  isLoading?: boolean;
  attachedElement?: { selector: string; description: string } | null;
  onRemoveElement?: () => void;
  // Image attachment props
  attachedImages?: AttachedImage[];
  addAttachedImages?: (images: AttachedImage[]) => void;
  removeAttachedImage?: (tempId: string) => void;
}

const suggestions = [
  { icon: Type, text: "Change the headline text" },
  { icon: Palette, text: "Update the color scheme" },
  { icon: Sparkles, text: "Make the design more modern" },
];

export function EmptyStatePrompt({
  onSuggestionClick,
  onEnterSelectorMode,
  selectorModeAvailable = false,
  selectorMode = false,
  input = "",
  setInput,
  onSend,
  isLoading = false,
  attachedElement,
  onRemoveElement,
  attachedImages = [],
  addAttachedImages,
  removeAttachedImage,
}: EmptyStatePromptProps) {
  const hasInput = setInput && onSend;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Auto-focus textarea on mount and when element is selected
  useEffect(() => {
    if (textareaRef.current && !isLoading) {
      textareaRef.current.focus();
    }
  }, [isLoading, attachedElement]);

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

      if (!addAttachedImages) return;

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
      if (!addAttachedImages) return;

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
          .filter(Boolean) as AttachedImage[];

        if (newImages.length > 0) {
          addAttachedImages(newImages);
        }
      }
    },
    [addAttachedImages]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!addAttachedImages) return;

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
      className={`flex flex-col items-center text-center px-6 py-8 h-full transition-colors ${
        isDragOver ? "bg-primary/5" : ""
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

      {/* Header */}
      <div className="mb-6">
        <div className="w-12 h-12 rounded-full bg-linear-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-3 mx-auto">
          <Sparkles className="w-6 h-6 text-amber-500" />
        </div>
        <h3 className="text-lg font-semibold mb-2">👋 Hi! How can I help?</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {selectorModeAvailable
            ? "Describe what you'd like to change, or click an element in the preview."
            : "Describe what you'd like to change."}
        </p>
      </div>

      {/* Integrated Input Area - more prominent */}
      {hasInput && (
        <div className="w-full max-w-md mb-10">
          {/* Attached element pill */}
          {attachedElement && onRemoveElement && (
            <div className="mb-3 text-left">
              <SelectedElementPill
                selector={attachedElement.selector}
                description={attachedElement.description}
                onRemove={onRemoveElement}
              />
            </div>
          )}

          {/* Attached image previews */}
          {attachedImages.length > 0 && removeAttachedImage && (
            <div className="mb-3 flex flex-wrap gap-2 justify-start">
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

          {/* Prominent textarea with subtle glow effect */}
          <textarea
            ref={textareaRef}
            className={`flex min-h-[100px] w-full rounded-xl border-2 bg-background px-4 py-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 resize-none shadow-sm transition-all ${
              isDragOver ? "border-primary border-dashed" : "border-primary/20"
            }`}
            placeholder={
              selectorMode
                ? "Click an element in the preview..."
                : attachedElement || attachedImages.length > 0
                ? "Describe what you want to change..."
                : "What would you like to change?"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            onPaste={handlePaste}
            disabled={isLoading}
            rows={3}
          />

          {/* Buttons row */}
          <div className="flex gap-2 mt-4 justify-between">
            {/* Left side - Upload button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="gap-2 text-muted-foreground hover:text-foreground"
              title="Upload image"
            >
              <Plus className="w-4 h-4" />
              Add Image
            </Button>

            {/* Right side - Selector and Send */}
            <div className="flex gap-2">
              {selectorModeAvailable && onEnterSelectorMode && (
                <Button
                  variant={selectorMode ? "default" : "outline"}
                  size="sm"
                  onClick={onEnterSelectorMode}
                  className={
                    selectorMode
                      ? "gap-2 bg-amber-500 hover:bg-amber-600 text-white"
                      : "gap-2 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                  }
                >
                  <MousePointerClick className="w-4 h-4" />
                  {selectorMode ? "Selecting..." : "Show me an Element"}
                </Button>
              )}
              <Button
                onClick={onSend}
                disabled={
                  isLoading ||
                  (!input.trim() &&
                    !attachedElement &&
                    attachedImages.length === 0)
                }
                size="sm"
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Send
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle suggestions - no background, just text */}
      <div className="w-full max-w-md">
        <p className="text-xs text-muted-foreground/60 mb-4">Or try:</p>
        <div className="flex flex-col gap-1">
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              onClick={() => onSuggestionClick?.(suggestion.text)}
              className="flex items-center gap-2 text-left text-sm py-2 px-1 rounded-md hover:bg-muted/30 transition-colors group"
            >
              <suggestion.icon className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-amber-500 transition-colors shrink-0" />
              <span className="text-muted-foreground/70 group-hover:text-foreground transition-colors">
                {suggestion.text}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
