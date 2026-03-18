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
  expandLabel?: boolean;
}

export function EditControls({
  projectSlug,
  editMode,
  hasUnsavedChanges,
  toggleEditMode,
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
            className={cn(
              "h-8 justify-start gap-0 overflow-hidden rounded-lg px-0 transition-[width,background-color,color,box-shadow] duration-200 ease-out",
              editMode && expandLabel
                ? "w-[104px] bg-primary/10 text-primary shadow-sm"
                : "w-8 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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
