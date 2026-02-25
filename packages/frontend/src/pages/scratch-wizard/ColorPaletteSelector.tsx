import { Sparkles, Wand2, Lock, Sun, Moon, Palette } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InteractiveSurfaceButton } from "@/components/ui/interactive-surface";
import { cn } from "@/lib/utils";
import { useScratchWizard } from "./ScratchWizardContext";
import { STYLE_PRESETS } from "./types";

function ColorSwatches({ palette }: { palette: string[] }) {
  return (
    <div className="flex gap-1">
      {palette.map((c, i) => (
        <span
          key={i}
          className="h-4 w-4 rounded-full border border-border"
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function SiteThemeToggle({
  theme,
  onChange,
  disabled,
}: {
  theme: "dark" | "light" | null;
  onChange: (theme: "dark" | "light" | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <InteractiveSurfaceButton
        variant="choice"
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn("flex-1 rounded-lg p-2.5", {
          "border-primary bg-primary/10 hover:border-primary hover:bg-primary/10":
            theme === null,
          "opacity-50 cursor-not-allowed": disabled,
        })}
      >
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Auto</span>
        </div>
      </InteractiveSurfaceButton>
      <InteractiveSurfaceButton
        variant="choice"
        disabled={disabled}
        onClick={() => onChange("dark")}
        className={cn("flex-1 rounded-lg p-2.5", {
          "border-primary bg-primary/10 hover:border-primary hover:bg-primary/10":
            theme === "dark",
          "opacity-50 cursor-not-allowed": disabled,
        })}
      >
        <div className="flex items-center justify-center gap-2">
          <Moon className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Dark</span>
        </div>
      </InteractiveSurfaceButton>
      <InteractiveSurfaceButton
        variant="choice"
        disabled={disabled}
        onClick={() => onChange("light")}
        className={cn("flex-1 rounded-lg p-2.5", {
          "border-primary bg-primary/10 hover:border-primary hover:bg-primary/10":
            theme === "light",
          "opacity-50 cursor-not-allowed": disabled,
        })}
      >
        <div className="flex items-center justify-center gap-2">
          <Sun className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Light</span>
        </div>
      </InteractiveSurfaceButton>
    </div>
  );
}

function ColorModeToggle({
  isStrict,
  onChange,
  disabled,
}: {
  isStrict: boolean;
  onChange: (strict: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <InteractiveSurfaceButton
          variant="choice"
          disabled={disabled}
          onClick={() => onChange(false)}
          className={cn("flex-1 rounded-lg p-2.5", {
            "border-primary bg-primary/10 hover:border-primary hover:bg-primary/10":
              !isStrict,
            "opacity-50 cursor-not-allowed": disabled,
          })}
        >
          <div className="flex items-center justify-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Inspiration</span>
          </div>
        </InteractiveSurfaceButton>
        <InteractiveSurfaceButton
          variant="choice"
          disabled={disabled}
          onClick={() => onChange(true)}
          className={cn("flex-1 rounded-lg p-2.5", {
            "border-primary bg-primary/10 hover:border-primary hover:bg-primary/10":
              isStrict,
            "opacity-50 cursor-not-allowed": disabled,
          })}
        >
          <div className="flex items-center justify-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Strict</span>
          </div>
        </InteractiveSurfaceButton>
      </div>
      <div className="text-xs text-muted-foreground">
        {isStrict
          ? "Use these exact colors"
          : "AI can adjust colors for harmony"}
      </div>
    </div>
  );
}

export function ColorPaletteSelector() {
  const {
    stylePreset,
    setStylePreset,
    isStyleExact,
    setIsStyleExact,
    siteTheme,
    setSiteTheme,
    isGenerating,
    started,
  } = useScratchWizard();

  const isDisabled = isGenerating || !!started;

  const handlePresetChange = (value: string) => {
    if (value === "auto") {
      setStylePreset(null);
    } else {
      const preset = STYLE_PRESETS.find((p) => p.id === value);
      setStylePreset(preset || null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Color Palette Dropdown */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <label className="text-sm font-medium">Color Palette</label>
        </div>
        <Select
          value={stylePreset?.id || "auto"}
          onValueChange={handlePresetChange}
          disabled={isDisabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              <div className="flex items-center gap-3">
                {stylePreset ? (
                  <>
                    <ColorSwatches palette={stylePreset.palette} />
                    <span>{stylePreset.name}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <span>Auto • Let AI decide</span>
                  </>
                )}
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              <div className="flex items-center gap-3">
                {/* Placeholder swatches to align with other options */}
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <span
                      key={i}
                      className="h-4 w-4 rounded-full border border-dashed border-muted-foreground/40 bg-gradient-to-br from-primary/10 to-transparent"
                    />
                  ))}
                </div>
                <div>
                  <div className="font-medium">Auto</div>
                  <div className="text-xs text-muted-foreground">
                    Let AI decide the colors
                  </div>
                </div>
              </div>
            </SelectItem>
            {STYLE_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                <div className="flex items-center gap-3">
                  <ColorSwatches palette={preset.palette} />
                  <div>
                    <div className="font-medium">{preset.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {preset.description}
                    </div>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Color mode toggle - only shown when a preset is selected */}
      {stylePreset && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="text-xs text-muted-foreground mb-2">
            How should we apply these colors?
          </div>
          <ColorModeToggle
            isStrict={isStyleExact}
            onChange={setIsStyleExact}
            disabled={isDisabled}
          />
        </div>
      )}

      {/* Site theme toggle */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium">Site Theme</span>
        </div>
        <SiteThemeToggle
          theme={siteTheme}
          onChange={setSiteTheme}
          disabled={isDisabled}
        />
      </div>
    </div>
  );
}
