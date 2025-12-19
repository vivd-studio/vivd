import { MousePointerClick, Sparkles, Palette, Type, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectedElementPill } from "./SelectedElementPill";
import { useEffect, useRef } from "react";

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
}: EmptyStatePromptProps) {
  const hasInput = setInput && onSend;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount and when element is selected
  useEffect(() => {
    if (textareaRef.current && !isLoading) {
      textareaRef.current.focus();
    }
  }, [isLoading, attachedElement]);

  return (
    <div className="flex flex-col items-center text-center px-6 py-12 h-full">
      {/* Header */}
      <div className="mb-8">
        <div className="w-14 h-14 rounded-full bg-linear-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-4 mx-auto">
          <Sparkles className="w-7 h-7 text-amber-500" />
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

          {/* Prominent textarea with subtle glow effect */}
          <textarea
            ref={textareaRef}
            className="flex min-h-[100px] w-full rounded-xl border-2 border-primary/20 bg-background px-4 py-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 resize-none shadow-sm transition-all"
            placeholder={
              selectorMode
                ? "Click an element in the preview..."
                : attachedElement
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
            disabled={isLoading}
            rows={3}
          />

          {/* Buttons row */}
          <div className="flex gap-2 mt-4 justify-end">
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
              disabled={isLoading || (!input.trim() && !attachedElement)}
              size="sm"
              className="gap-2"
            >
              <Send className="w-4 h-4" />
              Send
            </Button>
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
