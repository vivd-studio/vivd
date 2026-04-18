import { Check, Rocket, Sparkles, Zap } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@vivd/ui";

import { cn } from "@/lib/utils";
import type { ModelTier } from "@vivd/shared";

interface ScratchModelSelectorProps {
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
} as const;

export function ScratchModelSelector({
  models,
  selectedModel,
  onSelect,
  disabled,
  className,
}: ScratchModelSelectorProps) {
  if (models.length === 0) return null;

  const currentTier = selectedModel?.tier ?? "standard";
  const config = tierConfig[currentTier];
  const Icon = config.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label="Select initial generation model"
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/55 text-muted-foreground transition-all hover:border-primary/24 hover:bg-background/75 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <Icon className={cn("h-4 w-4", config.color)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-[220px]">
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
                className={cn("mt-0.5 h-4 w-4 shrink-0", modelConfig.color)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{modelConfig.label}</div>
                <div className="text-xs text-muted-foreground">
                  {modelConfig.description}
                </div>
              </div>
              {isSelected ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
