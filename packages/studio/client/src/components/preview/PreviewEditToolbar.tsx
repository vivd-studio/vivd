import { Loader2, Save, X, AlertCircle, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreview } from "./PreviewContext";

export function PreviewEditToolbar() {
  const {
    hasUnsavedChanges,
    editMode,
    handleSave,
    handleCancelEdit,
    isSaving,
  } = usePreview();

  if (!hasUnsavedChanges && !editMode) return null;

  const title = hasUnsavedChanges ? "Unsaved preview edits" : "Preview edit mode";
  const description = hasUnsavedChanges
    ? "Save or discard the pending preview changes."
    : "Click text in the preview to edit it.";
  const Icon = editMode ? Edit3 : AlertCircle;

  return (
    <div className="shrink-0 border-b border-white/10 bg-zinc-950 text-white">
      <div className="flex h-10 items-center gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="hidden truncate text-xs text-white/60 md:inline">
            {description}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSave}
            disabled={isSaving}
            className="h-7 rounded-md bg-white px-2.5 text-xs font-medium text-zinc-950 hover:bg-white/90"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCancelEdit}
            disabled={isSaving}
            className="h-7 rounded-md px-2.5 text-xs text-white hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
