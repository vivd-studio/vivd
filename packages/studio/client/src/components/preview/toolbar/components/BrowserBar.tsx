import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Monitor, TabletSmartphone, Smartphone } from "lucide-react";
import type { ViewportMode } from "../../types";

interface BrowserBarProps {
  viewportMode: ViewportMode;
  setViewportMode: (mode: ViewportMode) => void;
  currentPreviewPath: string;
  onNavigatePath: (path: string) => void;
  onRefresh: () => void;
}

const VIEWPORT_OPTIONS = [
  { mode: "desktop" as const, label: "Desktop", icon: Monitor },
  { mode: "tablet" as const, label: "Tablet", icon: TabletSmartphone },
  { mode: "mobile" as const, label: "Mobile", icon: Smartphone },
];

export function BrowserBar({
  viewportMode,
  setViewportMode,
  currentPreviewPath,
  onNavigatePath,
  onRefresh,
}: BrowserBarProps) {
  const [draftPath, setDraftPath] = useState(currentPreviewPath);

  useEffect(() => {
    setDraftPath(currentPreviewPath);
  }, [currentPreviewPath]);

  const submitPath = () => {
    onNavigatePath(draftPath);
  };

  const currentViewportIndex = VIEWPORT_OPTIONS.findIndex(
    (option) => option.mode === viewportMode,
  );
  const currentViewportOption =
    VIEWPORT_OPTIONS[currentViewportIndex >= 0 ? currentViewportIndex : 0];
  const CurrentViewportIcon = currentViewportOption.icon;

  const handleCycleViewport = () => {
    const nextOption =
      VIEWPORT_OPTIONS[(currentViewportIndex + 1) % VIEWPORT_OPTIONS.length];
    setViewportMode(nextOption.mode);
  };

  return (
    <div className="mx-auto flex w-full max-w-[256px] items-center gap-0.5 rounded-full border border-border/60 bg-background px-1 py-0.5 shadow-[0_8px_18px_rgba(15,23,42,0.035)]">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleCycleViewport}
        className="h-[26px] w-[26px] shrink-0 rounded-full text-muted-foreground/80"
        title={`Switch viewport (${currentViewportOption.label})`}
        aria-label={`Switch viewport (${currentViewportOption.label})`}
      >
        <CurrentViewportIcon className="h-3.25 w-3.25" />
      </Button>
      <form
        className="min-w-0 flex flex-1 items-center gap-0.5"
        onSubmit={(event) => {
          event.preventDefault();
          submitPath();
        }}
      >
        <Input
          value={draftPath}
          onChange={(event) => setDraftPath(event.target.value)}
          onBlur={() => setDraftPath(currentPreviewPath)}
          placeholder="/"
          className="h-[26px] border-0 bg-transparent px-1 text-[12px] text-muted-foreground/80 placeholder:text-muted-foreground/50 shadow-none focus-visible:bg-transparent"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          className="h-[26px] w-[26px] shrink-0 rounded-full text-muted-foreground/80"
        >
          <RefreshCw className="h-3.25 w-3.25" />
          <span className="sr-only">Refresh preview</span>
        </Button>
      </form>
    </div>
  );
}
