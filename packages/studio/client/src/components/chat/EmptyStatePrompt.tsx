import { Sparkles, Palette, Type } from "lucide-react";
import { ChatComposer } from "./ChatComposer";

interface EmptyStatePromptProps {
  onSuggestionClick?: (suggestion: string) => void;
}

const suggestions = [
  { icon: Type, text: "Change the headline text" },
  { icon: Palette, text: "Update the color scheme" },
  { icon: Sparkles, text: "Make the design more modern" },
];

export function EmptyStatePrompt({ onSuggestionClick }: EmptyStatePromptProps) {
  return (
    <div className="flex flex-col items-center text-center py-8 h-full">
      {/* Header */}
      <div className="mb-6 px-6">
        <div className="w-12 h-12 rounded-full bg-linear-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-3 mx-auto">
          <Sparkles className="w-6 h-6 text-amber-500" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Where should we begin?</h3>
      </div>

      {/* Unified Chat Composer */}
      <div className="w-full mb-8">
        <ChatComposer className="p-0" />
      </div>

      {/* Subtle suggestions - no background, just text */}
      <div className="w-full max-w-md px-6">
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
