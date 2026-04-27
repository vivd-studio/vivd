import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Panel,
} from "@vivd/ui";

import { Loader2 } from "lucide-react";

type EmbeddedStudioProjectDialogsProps = {
  projectSlug?: string;
  showRenameDialog: boolean;
  onShowRenameDialogChange: (open: boolean) => void;
  showDeleteConfirm: boolean;
  onShowDeleteConfirmChange: (open: boolean) => void;
  renameSlugInput: string;
  onRenameSlugInputChange: (value: string) => void;
  isRenamePending: boolean;
  isDeletePending: boolean;
  onRenameProject: () => void;
  onDeleteProject: () => void;
};

export function EmbeddedStudioProjectDialogs({
  projectSlug,
  showRenameDialog,
  onShowRenameDialogChange,
  showDeleteConfirm,
  onShowDeleteConfirmChange,
  renameSlugInput,
  onRenameSlugInputChange,
  isRenamePending,
  isDeletePending,
  onRenameProject,
  onDeleteProject,
}: EmbeddedStudioProjectDialogsProps) {
  const normalizedProjectSlug = projectSlug ?? "";
  const nextSlug = renameSlugInput.trim();
  const renameDisabled =
    isRenamePending ||
    !normalizedProjectSlug ||
    !nextSlug ||
    nextSlug.toLowerCase() === normalizedProjectSlug.toLowerCase();

  return (
    <>
      <AlertDialog
        open={showRenameDialog}
        onOpenChange={(open) => {
          if (isRenamePending) return;
          onShowRenameDialogChange(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename project slug?</AlertDialogTitle>
            <AlertDialogDescription>
              Change <strong>{projectSlug}</strong> to a new URL slug. This
              updates project references across the control plane. This can take
              a while and project actions stay locked until it completes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={renameSlugInput}
              onChange={(event) => onRenameSlugInputChange(event.target.value)}
              placeholder="new-project-slug"
              autoFocus
              disabled={isRenamePending}
            />
            {isRenamePending ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Renaming in progress. Please keep this page open.
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRenamePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={renameDisabled}
              onClick={onRenameProject}
            >
              {isRenamePending ? "Renaming..." : "Rename slug"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={onShowDeleteConfirmChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{projectSlug}</strong> and
              all its versions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeletePending}
              onClick={onDeleteProject}
            >
              {isDeletePending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isRenamePending ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <Panel className="flex max-w-sm flex-col items-center gap-2 px-4 py-3 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="text-sm font-medium">Renaming project slug...</div>
            <div className="text-xs text-muted-foreground">
              This may take a while. Project actions are temporarily disabled.
            </div>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
