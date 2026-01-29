import { Save, X, Edit3 } from "lucide-react";
import { usePreview } from "./PreviewContext";

export function UnsavedChangesBar() {
  const { hasUnsavedChanges, editMode, handleSave, handleCancelEdit, isSaving } =
    usePreview();

  if (!hasUnsavedChanges && !editMode) return null;

  const message = editMode ? "Editing text" : "Unsaved changes";
  const Icon = Edit3;

  return (
    <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 animate-in slide-in-from-bottom-4 fade-in duration-300 max-w-[calc(100vw-2rem)] px-2 sm:px-0">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-full bg-gradient-to-r from-amber-500/95 to-orange-500/95 backdrop-blur-sm shadow-lg shadow-amber-500/25 border border-amber-400/30">
        <div className="flex items-center gap-1.5 sm:gap-2 text-white">
          <Icon className="w-4 h-4 shrink-0" />
          <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
            {message}
          </span>
        </div>

        <div className="h-4 w-px bg-white/30 shrink-0" />

        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="h-7 px-2 sm:px-3 bg-white hover:bg-white/90 text-amber-700 font-medium rounded-full text-xs sm:text-sm flex items-center gap-1 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save</span>
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={isSaving}
            className="h-7 px-2 sm:px-3 text-white hover:bg-white/20 rounded-full text-xs sm:text-sm flex items-center gap-1 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Discard</span>
          </button>
        </div>
      </div>
    </div>
  );
}
