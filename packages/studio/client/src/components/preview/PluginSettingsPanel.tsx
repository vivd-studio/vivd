import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  buildHostAppUrl,
  buildProjectStudioPath,
} from "./toolbar/hostNavigation";

interface PluginSettingsPanelProps {
  projectSlug: string;
}

export function PluginSettingsPanel({
  projectSlug,
}: PluginSettingsPanelProps) {
  const [isLoading, setIsLoading] = useState(true);

  const src = useMemo(() => {
    const path = `${buildProjectStudioPath(projectSlug, "plugins")}?embedded=1`;
    return buildHostAppUrl(path);
  }, [projectSlug]);

  return (
    <div className="absolute inset-0 z-40 bg-background">
      {isLoading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">
              Loading plugin settings...
            </span>
          </div>
        </div>
      ) : null}

      <iframe
        src={src}
        title="Plugin settings"
        className="h-full w-full border-0 bg-background"
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}
