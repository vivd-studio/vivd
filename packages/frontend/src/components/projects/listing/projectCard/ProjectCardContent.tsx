import { Loader2, Plug, Settings2 } from "lucide-react";
import {
  Button,
  Panel,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@vivd/ui";

import { getProjectPluginPresentation } from "@/plugins/presentation";
import type { VersionInfo } from "../ProjectCard.types";

type ProjectPluginPresentation = ReturnType<
  typeof getProjectPluginPresentation
>;

interface ProjectCardContentProps {
  projectSlug: string;
  thumbnailUrl?: string | null;
  selectedVersionInfo?: VersionInfo;
  statusLabel: string;
  isCompleted: boolean;
  isFailed: boolean;
  isInitialGenerationPaused: boolean;
  isProcessing: boolean;
  canOpenStudio: boolean;
  canOverrideProjectStatus: boolean;
  isSetStatusPending: boolean;
  publishedDomain?: string | null;
  enabledPluginEntries: ProjectPluginPresentation[];
  isRenamePending: boolean;
  onOpenPlugins: () => void;
  onOpenPlugin: (path: string) => void;
  onOpenProjectStudio: () => void;
  onOpenStatusDialog: () => void;
}

export function ProjectCardContent({
  projectSlug,
  thumbnailUrl,
  selectedVersionInfo,
  statusLabel,
  isCompleted,
  isFailed,
  isInitialGenerationPaused,
  isProcessing,
  canOpenStudio,
  canOverrideProjectStatus,
  isSetStatusPending,
  publishedDomain,
  enabledPluginEntries,
  isRenamePending,
  onOpenPlugins,
  onOpenPlugin,
  onOpenProjectStudio,
  onOpenStatusDialog,
}: ProjectCardContentProps) {
  const pluginActions = (
    <div className="absolute right-2 bottom-2 flex items-center gap-1">
      <TooltipProvider delayDuration={100}>
        {enabledPluginEntries.map((plugin) => {
          const PluginIcon = plugin.icon;
          return (
            <Tooltip key={`preview-plugin-${plugin.pluginId}`}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md bg-black/50 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md hover:bg-black/70 hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (plugin.path) {
                      onOpenPlugin(plugin.path);
                    }
                  }}
                  disabled={isRenamePending || !plugin.path}
                >
                  <PluginIcon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{plugin.title}</TooltipContent>
            </Tooltip>
          );
        })}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md bg-black/50 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md hover:bg-black/70 hover:text-white"
              onClick={(event) => {
                event.stopPropagation();
                onOpenPlugins();
              }}
              disabled={isRenamePending}
            >
              <Plug className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Plugins</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );

  if (isCompleted && thumbnailUrl) {
    return (
      <div className="relative mx-1 mb-2 overflow-hidden rounded-xl">
        <img
          src={thumbnailUrl}
          alt={`${projectSlug} preview`}
          className="aspect-video w-full object-cover object-top"
          loading="lazy"
        />
        {publishedDomain ? (
          <div className="absolute left-2.5 bottom-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-black/50 px-2.5 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur-md ring-1 ring-white/10">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_4px_--theme(--color-emerald-400/0.6)]"
              />
              Published
            </span>
          </div>
        ) : null}
        {pluginActions}
      </div>
    );
  }

  if (isCompleted) {
    return (
      <Panel
        tone="dashed"
        className="relative mx-1 mb-2 aspect-video border-dotted"
        aria-label={`${projectSlug} preview missing`}
      >
        {publishedDomain ? (
          <div className="absolute left-2.5 bottom-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-black/50 px-2.5 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur-md ring-1 ring-white/10">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_4px_--theme(--color-emerald-400/0.6)]"
              />
              Published
            </span>
          </div>
        ) : null}
        {pluginActions}
      </Panel>
    );
  }

  // Non-thumbnail states: processing / failed / paused
  if (isProcessing) {
    return (
      <Panel
        tone="sunken"
        className="mx-3 mt-1 flex grow flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground"
      >
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">{statusLabel}...</span>
        </div>
        {canOpenStudio ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProjectStudio();
            }}
          >
            Open Studio
          </Button>
        ) : null}
        {canOverrideProjectStatus ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(event) => {
              event.stopPropagation();
              onOpenStatusDialog();
            }}
            disabled={isSetStatusPending}
          >
            <Settings2
              className={`w-3 h-3 mr-1 ${isSetStatusPending ? "animate-spin" : ""}`}
            />
            {isSetStatusPending ? "Updating..." : "Set status"}
          </Button>
        ) : null}
      </Panel>
    );
  }

  if (isFailed) {
    return (
      <Panel
        tone="sunken"
        className="mx-3 mt-1 flex grow flex-col items-center justify-center space-y-1 p-4 text-center text-sm text-destructive"
      >
        <div className="font-medium">Generation failed</div>
        {selectedVersionInfo?.errorMessage ? (
          <div className="text-xs text-muted-foreground">
            {selectedVersionInfo.errorMessage}
          </div>
        ) : null}
        {canOpenStudio ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProjectStudio();
            }}
          >
            Open Studio
          </Button>
        ) : null}
        {canOverrideProjectStatus ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpenStatusDialog();
            }}
            disabled={isSetStatusPending}
          >
            Set status
          </Button>
        ) : null}
      </Panel>
    );
  }

  if (isInitialGenerationPaused) {
    return (
      <Panel
        tone="sunken"
        className="mx-3 mt-1 flex grow flex-col items-center justify-center space-y-2 p-4 text-center text-sm"
      >
        <div className="font-medium text-foreground">
          Initial generation paused
        </div>
        <div className="text-xs text-muted-foreground max-w-[24rem]">
          {selectedVersionInfo?.errorMessage ||
            "The bootstrap run stopped before finishing. Open Studio to continue the same project from there."}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProjectStudio();
          }}
        >
          Open Studio
        </Button>
        {canOverrideProjectStatus ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpenStatusDialog();
            }}
            disabled={isSetStatusPending}
          >
            Set status
          </Button>
        ) : null}
      </Panel>
    );
  }

  return null;
}
