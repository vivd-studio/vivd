import { Zap, Sparkles, Rocket, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ModelTier {
  tier: "standard" | "advanced" | "pro";
  provider: string;
  modelId: string;
  label: string;
}

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
          const isSelected =
            selectedModel?.provider === model.provider &&
            selectedModel?.modelId === model.modelId;

          return (
            <DropdownMenuItem
              key={`${model.provider}/${model.modelId}`}
              onClick={() => onSelect(model)}
              className="flex items-start gap-2.5 py-2"
            >
              <ModelIcon
                className={cn("w-4 h-4 mt-0.5 shrink-0", modelConfig.color)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{modelConfig.label}</div>
                <div className="text-xs text-muted-foreground">
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
