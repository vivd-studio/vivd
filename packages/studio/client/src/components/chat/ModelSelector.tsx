import { Check, Rocket, Sparkles, Zap } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@vivd/ui";

import { cn } from "@/lib/utils";
import type { ModelTier } from "./chatTypes";

interface ModelSelectorProps {
  models: ModelTier[];
  selectedModel: ModelTier | null;
  onSelect: (model: ModelTier) => void;
  disabled?: boolean;
  className?: string;
}

const tierConfig = {
  standard: {
    icon: Zap,
    color: "text-blue-500",
    label: "Standard",
    description: "Faster, less credit usage",
  },
  advanced: {
    icon: Sparkles,
    color: "text-amber-500",
    label: "Advanced",
    description: "Smarter, uses more credits",
  },
  pro: {
    icon: Rocket,
    color: "text-purple-500",
    label: "Pro",
    description: "Maximum capability",
  },
};

export function ModelSelector({
  models,
  selectedModel,
  onSelect,
  disabled,
  className,
}: ModelSelectorProps) {
  if (models.length === 0) return null;

  const currentTier = selectedModel?.tier ?? "standard";
  const config = tierConfig[currentTier];
  const Icon = config.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className={cn(
            "flex items-center justify-center h-8 w-8 rounded-full transition-all",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        >
          <Icon className={cn("w-4 h-4", config.color)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[200px]">
        {models.map((model) => {
          const modelConfig = tierConfig[model.tier];
          const ModelIcon = modelConfig.icon;
          const isSelected = selectedModel?.tier === model.tier;

          return (
            <DropdownMenuItem
              key={model.tier}
              onClick={() => onSelect(model)}
              className="flex items-start gap-2.5 py-2"
            >
              <ModelIcon
                className={cn("w-4 h-4 mt-0.5 shrink-0", modelConfig.color)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-base font-medium">{modelConfig.label}</div>
                <div className="text-sm text-muted-foreground">
                  {modelConfig.description}
                </div>
              </div>
              {isSelected && (
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
