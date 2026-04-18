import { Plug } from "lucide-react";
import { Button, CardFooter, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@vivd/ui";

import { getProjectPluginPresentation } from "@/plugins/presentation";

type ProjectPluginPresentation = ReturnType<
  typeof getProjectPluginPresentation
>;

interface ProjectCardFooterProps {
  enabledPluginEntries: ProjectPluginPresentation[];
  isRenamePending: boolean;
  onOpenPlugins: () => void;
  onOpenPlugin: (path: string) => void;
}

export function ProjectCardFooter({
  enabledPluginEntries,
  isRenamePending,
  onOpenPlugins,
  onOpenPlugin,
}: ProjectCardFooterProps) {
  return (
    <CardFooter className="pt-2.5 pb-3 px-4 flex items-center justify-end gap-1 border-t border-border/30 mt-auto">
      <TooltipProvider delayDuration={100}>
        {enabledPluginEntries.map((plugin) => {
          const PluginIcon = plugin.icon;
          return (
            <Tooltip key={`footer-plugin-${plugin.pluginId}`}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (plugin.path) {
                      onOpenPlugin(plugin.path);
                    }
                  }}
                  disabled={isRenamePending || !plugin.path}
                >
                  <PluginIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{plugin.title}</TooltipContent>
            </Tooltip>
          );
        })}
        {enabledPluginEntries.length > 0 ? (
          <span
            className="mx-1 h-3.5 w-px bg-border/60 rounded-full"
            aria-hidden
          />
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onOpenPlugins();
              }}
              disabled={isRenamePending}
            >
              <Plug className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Plugins</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </CardFooter>
  );
}
