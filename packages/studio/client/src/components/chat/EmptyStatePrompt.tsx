import { Loader2, Palette, Sparkles, Type } from "lucide-react";
import { Button } from "@vivd/ui";

import { ChatInputRegion } from "./ChatInputRegion";

interface EmptyStatePromptProps {
  onSuggestionClick?: (suggestion: string) => void;
  initialGenerationRequested?: boolean;
  initialGenerationStarting?: boolean;
  initialGenerationAwaitingSession?: boolean;
  initialGenerationFailed?: string | null;
  onRetryInitialGeneration?: () => void;
}

const suggestions = [
  { icon: Type, text: "Change the headline text" },
  { icon: Palette, text: "Update the color scheme" },
  { icon: Sparkles, text: "Make the design more modern" },
];

export function EmptyStatePrompt({
  onSuggestionClick,
  initialGenerationRequested = false,
  initialGenerationStarting = false,
  initialGenerationAwaitingSession = false,
  initialGenerationFailed = null,
  onRetryInitialGeneration,
}: EmptyStatePromptProps) {
  const showInitialGenerationWaitingState =
    initialGenerationRequested &&
    !initialGenerationFailed &&
    (initialGenerationStarting || initialGenerationAwaitingSession);

  return (
    <div className="flex flex-col items-center text-center py-8 h-full">
      {/* Header */}
      <div className="mb-6 px-4">
        <div className="w-12 h-12 rounded-full bg-linear-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-3 mx-auto">
          <Sparkles className="w-6 h-6 text-amber-500" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Where should we begin?</h3>
      </div>

      {initialGenerationRequested ? (
        <div className="mb-6 flex w-full max-w-md flex-col items-center gap-3 px-6">
          {showInitialGenerationWaitingState ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {initialGenerationStarting
                ? "Starting initial site generation..."
                : "Attaching the initial generation session..."}
            </div>
          ) : null}
          {initialGenerationFailed ? (
            <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
              <div className="text-sm text-destructive">
                Initial generation did not start: {initialGenerationFailed}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onRetryInitialGeneration}
              >
                Retry initial generation
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!showInitialGenerationWaitingState ? (
        <div className="mb-8 w-full">
          <ChatInputRegion composerClassName="pb-0" />
        </div>
      ) : null}

      {/* Subtle suggestions - no background, just text */}
      <div className="w-full max-w-md px-4">
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
