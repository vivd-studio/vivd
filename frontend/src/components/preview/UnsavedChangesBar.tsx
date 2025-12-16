import { Save, X, AlertCircle, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreviewModal } from "./PreviewModalContext";

export function UnsavedChangesBar() {
  const {
    hasUnsavedChanges,
    editMode,
    handleSave,
    handleCancelEdit,
    saveFileMutation,
  } = usePreviewModal();

  // Show when there are unsaved changes OR in edit mode
  if (!hasUnsavedChanges && !editMode) return null;

  // Determine the message based on the context
  const message = editMode ? "Editing text" : "Unsaved changes";
  const Icon = editMode ? Edit3 : AlertCircle;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-linear-to-r from-amber-500/95 to-orange-500/95 backdrop-blur-sm shadow-lg shadow-amber-500/25 border border-amber-400/30">
        <div className="flex items-center gap-2 text-white">
          <Icon className="w-4 h-4" />
          <span className="text-sm font-medium">{message}</span>
        </div>

        <div className="h-4 w-px bg-white/30" />

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSave}
            disabled={saveFileMutation.isPending}
            className="h-7 px-3 bg-white hover:bg-white/90 text-amber-700 font-medium rounded-full"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCancelEdit}
            disabled={saveFileMutation.isPending}
            className="h-7 px-3 text-white hover:bg-white/20 hover:text-white rounded-full"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
