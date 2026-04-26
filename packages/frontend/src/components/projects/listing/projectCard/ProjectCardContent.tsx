import { Loader2, Settings2 } from "lucide-react";
import { Button, Panel, PanelContent } from "@vivd/ui";

import type { VersionInfo } from "../ProjectCard.types";

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
  onOpenProjectStudio,
  onOpenStatusDialog,
}: ProjectCardContentProps) {
  return (
    <PanelContent className="flex grow flex-col px-4 pb-1.5 pt-0">
      {isCompleted && thumbnailUrl ? (
        <Panel tone="sunken" className="mb-2 overflow-hidden p-0">
          <img
            src={thumbnailUrl}
            alt={`${projectSlug} preview`}
            className="w-full h-full object-cover object-top"
            loading="lazy"
          />
        </Panel>
      ) : null}

      {isProcessing ? (
        <Panel
          tone="sunken"
          className="flex grow flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground"
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
      ) : null}

      {isFailed ? (
        <Panel
          tone="sunken"
          className="flex grow flex-col items-center justify-center space-y-1 p-4 text-center text-sm text-destructive"
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
      ) : null}

      {isInitialGenerationPaused ? (
        <Panel
          tone="sunken"
          className="flex grow flex-col items-center justify-center space-y-2 p-4 text-center text-sm"
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
      ) : null}
    </PanelContent>
  );
}
