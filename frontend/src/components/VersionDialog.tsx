import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";

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
                Create New Version (v{currentVersion + 1})
              </div>
              <div className="text-xs opacity-80">
                Keep existing versions and create a new one
              </div>
            </div>
          </Button>
          <Button
            variant="outline"
            onClick={onOverwriteCurrent}
            className="w-full justify-start gap-2 h-auto py-3 border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
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
