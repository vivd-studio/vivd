import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Send, MousePointerClick, X, Square } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SelectedElementPill, AttachedFilePill } from "./SelectedElementPill";
import { ImagePreviewPill } from "./ImagePreviewPill";
import { ModelSelector } from "./ModelSelector";
import { useChatContext } from "./ChatContext";
import { InteractiveSurface } from "@/components/ui/interactive-surface";

import { cn } from "@/lib/utils";

/**
 * ChatComposer - Unified chat input component
 *
 * Used in both the empty state (start session) and in-session views.
 * Features a rounded container with:
 * - Textarea at the top
 * - Action bar at bottom (no separator) with: Plus circle (dropdown), Element selector, Send button
 * - Colored border styling
 */
interface ChatComposerProps {
  className?: string;
}

export function ChatComposer({ className }: ChatComposerProps) {
  const {
    input,
    setInput,
    handleSend,
    handleStopGeneration,
    attachedElement,
    setAttachedElement,
    attachedImages,
    addAttachedImages,
    removeAttachedImage,
    attachedFiles,
    removeAttachedFile,
    selectorMode,
    setSelectorMode,
    isLoading,
    isStreaming,
    isWaiting,
    isUsageBlocked,
    selectorModeAvailable,
    availableModels,
    selectedModel,
    setSelectedModel,
  } = useChatContext();

  // Combine loading and blocked states for disabling
  const isDisabled = isLoading || isUsageBlocked;
  const isGenerating = isStreaming || isWaiting;

  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    if (textareaRef.current && !isLoading) {
      textareaRef.current.focus();
    }
  }, [isLoading, attachedElement]);

  // Reset textarea height when input is cleared
  useEffect(() => {
    if (input === "" && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input]);

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

      if (files.length > 0) {
        const newFiles = files.map((file) => ({
          file,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : "",
          tempId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        addAttachedImages(newFiles);
      }
    },
    [addAttachedImages],
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
    [addAttachedImages],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);

      if (files.length > 0) {
        const newFiles = files.map((file) => ({
          file,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : "",
          tempId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        addAttachedImages(newFiles);
      }

      // Reset input to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [addAttachedImages],
  );

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isUsageBlocked) {
        handleSend();
      }
    }
  };

  const canSend =
    !isDisabled &&
    (input.trim() ||
      attachedElement ||
      attachedImages.length > 0 ||
      attachedFiles.length > 0);

  return (
    <div
      className={cn(
        "px-3 pb-3 pt-0 md:px-6 md:pb-6 md:pt-0 mt-auto transition-colors",
        isDragOver ? "bg-primary/5" : "",
        className,
      )}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
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

      {/* Show attached files above input */}
      {attachedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachedFiles.map((file) => (
            <AttachedFilePill
              key={file.id}
              filename={file.filename}
              path={file.path}
              onRemove={() => removeAttachedFile(file.id)}
            />
          ))}
        </div>
      )}

      {/* Main input container - single shared surface for textarea + action row */}
      <InteractiveSurface
        variant="field"
        className={cn("rounded-xl overflow-hidden shadow-sm", {
          "border-primary border-dashed bg-primary/5": isDragOver,
          "border-destructive/55": !isDragOver && isUsageBlocked,
        })}
      >
        {/* Textarea - inside container with proper padding */}
        <textarea
          ref={textareaRef}
          className="flex min-h-[56px] max-h-[200px] w-full !bg-transparent px-4 pt-3 pb-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-none"
          placeholder={
            isUsageBlocked
              ? "Usage limit reached. Please wait for the limit to reset."
              : selectorMode
                ? "Click an element in the preview..."
                : attachedElement || attachedImages.length > 0
                  ? "Describe what you want to change..."
                  : "What would you like to change?"
          }
          value={input}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isDisabled}
          rows={2}
        />

        {/* Action bar at the bottom - no separator */}
        <div className="flex items-center justify-between gap-2 px-3 pb-2 bg-transparent">
          {/* Left side: Plus circle button + Element selector */}
          <div className="flex items-center gap-1">
            {/* Plus button - circle with dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isDisabled}
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add File
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Element selector button - expands on hover with text */}
            {selectorModeAvailable && setSelectorMode && (
              <button
                onClick={() => setSelectorMode(!selectorMode)}
                disabled={isDisabled}
                className={`group flex items-center gap-0 h-8 rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectorMode
                    ? "bg-amber-500 hover:bg-amber-600 text-white px-3"
                    : "text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 border border-transparent hover:border-amber-500/40 hover:bg-amber-500/5"
                }`}
              >
                <span
                  className={`flex items-center justify-center ${
                    selectorMode ? "" : "w-8 h-8"
                  }`}
                >
                  {selectorMode ? (
                    <X className="w-4 h-4" />
                  ) : (
                    <MousePointerClick className="w-4 h-4" />
                  )}
                </span>
                <span
                  className={`overflow-hidden whitespace-nowrap text-sm transition-all duration-200 ${
                    selectorMode
                      ? "max-w-[100px] opacity-100 ml-1"
                      : "max-w-0 opacity-0 group-hover:max-w-[150px] group-hover:opacity-100 group-hover:ml-1 group-hover:mr-2"
                  }`}
                >
                  {selectorMode ? "Cancel" : "Show me an Element"}
                </span>
              </button>
            )}
          </div>

          {/* Right side: Model selector + Send button */}
          <div className="flex items-center gap-1">
            {/* Model selector dropdown - only when multiple models available */}
            {availableModels.length > 0 && (
              <ModelSelector
                models={availableModels}
                selectedModel={selectedModel}
                onSelect={setSelectedModel}
                disabled={isDisabled}
              />
            )}

            {/* Stop button - only shown when generating */}
            {isGenerating && (
              <Button
                onClick={handleStopGeneration}
                size="icon"
                variant="destructive"
                className="h-8 w-8 rounded-full"
              >
                <Square className="w-4 h-4" />
              </Button>
            )}

            {/* Send button - always visible */}
            <Button
              onClick={handleSend}
              disabled={!canSend}
              size="icon"
              className="h-8 w-8 rounded-full"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </InteractiveSurface>
    </div>
  );
}
