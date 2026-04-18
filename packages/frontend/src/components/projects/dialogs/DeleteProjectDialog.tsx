import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button, Input, Label } from "@vivd/ui";

import { AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";

interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: (confirmationText: string) => void;
  projectName: string;
  isDeleting?: boolean;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  onConfirmDelete,
  projectName,
  isDeleting = false,
}: DeleteProjectDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");

  // Reset confirmation text when dialog closes
  useEffect(() => {
    if (!open) {
      setConfirmationText("");
    }
  }, [open]);

  const isConfirmationValid = confirmationText === projectName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isConfirmationValid && !isDeleting) {
      onConfirmDelete(confirmationText);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Project
          </DialogTitle>
          <DialogDescription className="space-y-3 pt-2">
            <span className="block">
              This action <strong>cannot be undone</strong>. This will
              permanently delete the project{" "}
              <strong className="text-foreground">{projectName}</strong>,
              including all versions and files.
            </span>
            <span className="block text-destructive">
              If this project is published, it will also be unpublished.
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="confirmation">
                Please type{" "}
                <strong className="font-mono text-foreground select-all">
                  {projectName}
                </strong>{" "}
                to confirm
              </Label>
              <Input
                id="confirmation"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                placeholder={projectName}
                autoComplete="off"
                autoFocus
                disabled={isDeleting}
                className={
                  confirmationText.length > 0 && !isConfirmationValid
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!isConfirmationValid || isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete this project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
