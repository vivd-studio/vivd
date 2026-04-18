import { Loader2, Settings2 } from "lucide-react";
import { Button, CardContent } from "@vivd/ui";

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
    <CardContent className="pb-1.5 px-4 grow flex flex-col">
      {isCompleted && thumbnailUrl ? (
        <div className="w-full aspect-[16/10] rounded-md overflow-hidden bg-muted mb-2">
          <img
            src={thumbnailUrl}
            alt={`${projectSlug} preview`}
            className="w-full h-full object-cover object-top"
            loading="lazy"
          />
        </div>
      ) : null}

      {isProcessing ? (
        <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground grow">
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
        </div>
      ) : null}

      {isFailed ? (
        <div className="text-sm text-center text-destructive space-y-1 flex flex-col items-center justify-center grow">
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
        </div>
      ) : null}

      {isInitialGenerationPaused ? (
        <div className="text-sm text-center space-y-2 flex flex-col items-center justify-center grow">
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
        </div>
      ) : null}
    </CardContent>
  );
}
