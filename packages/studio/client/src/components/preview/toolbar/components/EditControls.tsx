import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Edit3, FolderOpen } from "lucide-react";

interface EditControlsProps {
  projectSlug: string | undefined;
  assetsOpen: boolean;
  setAssetsOpen: (value: boolean) => void;
  editMode: boolean;
  hasUnsavedChanges: boolean;
  toggleEditMode: () => void;
}

export function EditControls({
  projectSlug,
  assetsOpen,
  setAssetsOpen,
  editMode,
  hasUnsavedChanges,
  toggleEditMode,
}: EditControlsProps) {
  if (!projectSlug) return null;

  return (
    <div className="hidden md:flex items-center gap-1">
      {/* Assets button */}
      <Button
        variant={assetsOpen ? "secondary" : "outline"}
        size="sm"
        onClick={() => setAssetsOpen(!assetsOpen)}
        className={`h-8 ${
          !assetsOpen
            ? "border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400"
            : ""
        }`}
      >
        <FolderOpen className="w-4 h-4 mr-1.5" />
        <span className="hidden lg:inline">Assets</span>
      </Button>

      {/* Edit button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant={editMode ? "secondary" : "outline"}
              size="sm"
              onClick={toggleEditMode}
              disabled={hasUnsavedChanges && !editMode}
              className={`h-8 ${
                !editMode && !hasUnsavedChanges
                  ? "border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                  : ""
              }`}
            >
              <Edit3 className="w-4 h-4 mr-1.5" />
              <span className="hidden lg:inline">
                {editMode ? "Editing..." : "Edit Text"}
              </span>
            </Button>
          </span>
        </TooltipTrigger>
        {hasUnsavedChanges && !editMode && (
          <TooltipContent>
            Save or discard image changes first
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}
