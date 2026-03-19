import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Edit3 } from "lucide-react";

interface EditControlsProps {
  projectSlug: string | undefined;
  editMode: boolean;
  hasUnsavedChanges: boolean;
  toggleEditMode: () => void;
  expandedWidth?: number;
  expandLabel?: boolean;
}

export function EditControls({
  projectSlug,
  editMode,
  hasUnsavedChanges,
  toggleEditMode,
  expandedWidth = 104,
  expandLabel = true,
}: EditControlsProps) {
  if (!projectSlug) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleEditMode}
            disabled={hasUnsavedChanges && !editMode}
            style={
              {
                ["--toolbar-expanded-width" as const]: `${expandedWidth}px`,
              } as CSSProperties
            }
            className={cn(
              "group relative z-20 h-8 w-8 justify-start gap-0 overflow-hidden rounded-lg px-0 transition-[width,background-color,color,box-shadow] duration-200 ease-out",
              editMode
                ? "bg-background text-primary shadow-sm ring-1 ring-primary/20"
                : "text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm hover:ring-1 hover:ring-border/60",
              editMode && expandLabel
                ? "w-[var(--toolbar-expanded-width)]"
                : undefined,
              !editMode && expandLabel
                ? "hover:w-[var(--toolbar-expanded-width)]"
                : undefined,
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <Edit3 className="h-4 w-4 shrink-0" />
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "overflow-hidden whitespace-nowrap text-[13px] font-medium transition-[max-width,opacity,padding] duration-200 ease-out",
                editMode && expandLabel
                  ? "max-w-24 pl-0.5 pr-2.5 opacity-100"
                  : "max-w-0 pl-0 pr-0 opacity-0",
                !editMode && expandLabel
                  ? "group-hover:max-w-24 group-hover:pl-0.5 group-hover:pr-2.5 group-hover:opacity-100"
                  : undefined,
              )}
            >
              Edit text
            </span>
            <span className="sr-only">
              {editMode ? "Editing text" : "Edit text"}
            </span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {hasUnsavedChanges && !editMode
          ? "Save or discard image changes first"
          : editMode
            ? "Editing text"
            : "Edit text"}
      </TooltipContent>
    </Tooltip>
  );
}
