import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, InteractiveSurface } from "@vivd/ui";

import { ChevronsRight, Plus, Send, MousePointerClick, X, Square } from "lucide-react";
import { SelectedElementPill, AttachedFilePill } from "./SelectedElementPill";
import { ImagePreviewPill } from "./ImagePreviewPill";
import { ModelSelector } from "./ModelSelector";
import { useChatContext } from "./ChatContext";
import { STUDIO_CHAT_ATTACHMENT_MAX_FILES } from "@studio/shared/chatAttachmentPolicy";

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
    followupBehavior,
    setFollowupBehavior,
    showSteerButton,
    selectorMode,
    setSelectorMode,
    isLoading,
    isThinking,
    isUsageBlocked,
    selectorModeAvailable,
    availableModels,
    selectedModel,
    setSelectedModel,
    handleSteerSend,
  } = useChatContext();

  // Combine loading and blocked states for disabling
  const isDisabled = isLoading || isUsageBlocked;
  const isGenerating = isThinking;

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

  const appendDroppedFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const remainingSlots = Math.max(
        STUDIO_CHAT_ATTACHMENT_MAX_FILES - attachedImages.length,
        0,
      );

      if (remainingSlots === 0) {
        toast.info(
          `Chat uploads are limited to ${STUDIO_CHAT_ATTACHMENT_MAX_FILES} files.`,
          {
            description:
              "Remove an existing temporary attachment before adding more.",
          },
        );
        return;
      }

      const acceptedFiles = files.slice(0, remainingSlots);
      const ignoredCount = files.length - acceptedFiles.length;

      if (acceptedFiles.length > 0) {
        addAttachedImages(
          acceptedFiles.map((file) => ({
            file,
            previewUrl: file.type.startsWith("image/")
              ? URL.createObjectURL(file)
              : "",
            tempId: `${Date.now()}-${Math.random()
              .toString(36)
              .substr(2, 9)}`,
          })),
        );
      }

      if (ignoredCount > 0) {
        toast.info(
          `Only ${STUDIO_CHAT_ATTACHMENT_MAX_FILES} temporary chat files can be queued at once.`,
          {
            description: `${ignoredCount} file${ignoredCount === 1 ? "" : "s"} ${
              ignoredCount === 1 ? "was" : "were"
            } ignored.`,
          },
        );
      }
    },
    [addAttachedImages, attachedImages.length],
  );

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
      appendDroppedFiles(files);
    },
    [appendDroppedFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      if (imageItems.length > 0) {
        e.preventDefault();
        const newImages = imageItems
          .map((item) => {
            return item.getAsFile();
          })
          .filter(Boolean) as File[];

        if (newImages.length > 0) {
          appendDroppedFiles(newImages);
        }
      }
    },
    [appendDroppedFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      appendDroppedFiles(files);

      // Reset input to allow selecting the same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [appendDroppedFiles],
  );

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const canSend =
    !isDisabled &&
    (input.trim() ||
      attachedElement ||
      attachedImages.length > 0 ||
      attachedFiles.length > 0);
  const showSteerActions = showSteerButton && canSend;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isUsageBlocked) return;

      if (e.metaKey && showSteerActions) {
        handleSteerSend();
        return;
      }

      handleSend();
    }
  };

  return (
    <div
      className={cn(
        "mt-auto pb-3 pl-[15px] pr-3 pt-0 transition-colors md:pb-3.5 md:pl-[17px] md:pr-3.5 md:pt-0",
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
          className="flex min-h-[56px] max-h-[200px] w-full resize-none !bg-transparent px-4 pt-3.5 pb-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="flex items-center justify-between gap-2 bg-transparent px-3 pb-2">
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
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    Follow-up behavior
                    <DropdownMenuShortcut>
                      {followupBehavior === "queue" ? "Queue" : "Steer"}
                    </DropdownMenuShortcut>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuLabel>When a session is busy</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={followupBehavior}
                      onValueChange={(value) =>
                        setFollowupBehavior(value as "queue" | "steer")
                      }
                    >
                      <DropdownMenuRadioItem value="steer">
                        Steer
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="queue">
                        Queue
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
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
                title="Stop generation"
                aria-label="Stop generation"
              >
                <Square className="w-4 h-4" />
              </Button>
            )}

            {showSteerActions ? (
              <>
                <Button
                  onClick={handleSteerSend}
                  disabled={!canSend}
                  size="sm"
                  variant="secondary"
                  className="h-8 rounded-full px-3"
                  title="Steer message (Cmd+Enter)"
                  aria-label="Steer message"
                  aria-keyshortcuts="Meta+Enter"
                >
                  <ChevronsRight className="mr-1.5 h-3.5 w-3.5" />
                  Steer
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={!canSend}
                  size="sm"
                  className="h-8 rounded-full px-3"
                >
                  Queue
                </Button>
              </>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!canSend}
                size="icon"
                className="h-8 w-8 rounded-full"
                title="Send message"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </InteractiveSurface>
    </div>
  );
}
