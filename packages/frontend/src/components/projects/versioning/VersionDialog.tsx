import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from "@vivd/ui";

import { Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";

interface VersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateNewVersion: () => void;
  onOverwriteCurrent: () => void;
  projectName?: string;
  currentVersion: number;
  totalVersions: number;
}

export function VersionDialog({
  open,
  onOpenChange,
  onCreateNewVersion,
  onOverwriteCurrent,
  projectName,
  currentVersion,
  totalVersions,
}: VersionDialogProps) {
  const [showConfirmOverwrite, setShowConfirmOverwrite] = useState(false);

  // Reset confirmation state when dialog closes
  useEffect(() => {
    if (!open) {
      setShowConfirmOverwrite(false);
    }
  }, [open]);

  const handleOverwriteClick = () => {
    setShowConfirmOverwrite(true);
  };

  const handleConfirmOverwrite = () => {
    setShowConfirmOverwrite(false);
    onOverwriteCurrent();
  };

  const handleCancelOverwrite = () => {
    setShowConfirmOverwrite(false);
  };

  // Confirmation view for overwrite
  if (showConfirmOverwrite) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Confirm Overwrite
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Are you sure you want to overwrite{" "}
                <strong>v{currentVersion}</strong>?
              </span>
              <span className="block text-amber-600">
                This will permanently delete all files in the current version
                and regenerate it from scratch.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={handleCancelOverwrite}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmOverwrite}>
              Yes, Overwrite v{currentVersion}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Main dialog view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Already Exists</DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              {projectName
                ? `A project for "${projectName}" already exists with ${totalVersions} version${
                    totalVersions > 1 ? "s" : ""
                  }.`
                : `This project already exists with ${totalVersions} version${
                    totalVersions > 1 ? "s" : ""
                  }.`}
            </span>
            <span className="block text-muted-foreground">
              Current version: v{currentVersion}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button
            variant="default"
            onClick={onCreateNewVersion}
            className="w-full justify-start gap-2 h-auto py-3 bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            <div className="text-left">
              <div className="font-medium">
                Create New Version (v{totalVersions + 1})
              </div>
              <div className="text-xs opacity-80">
                Keep existing versions and create a new one
              </div>
            </div>
          </Button>
          <Button
            variant="outline"
            onClick={handleOverwriteClick}
            className="w-full justify-start gap-2 h-auto py-3 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
          >
            <RefreshCw className="h-4 w-4" />
            <div className="text-left">
              <div className="font-medium">
                Overwrite Current (v{currentVersion})
              </div>
              <div className="text-xs opacity-80">
                Delete and regenerate the current version
              </div>
            </div>
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
