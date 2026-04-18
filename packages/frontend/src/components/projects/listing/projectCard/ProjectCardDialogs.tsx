import type { ProjectVersionManualStatus } from "@vivd/shared/types";
import { Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vivd/ui";

import type { ManualProjectStatusOption } from "./ProjectCard.helpers";

interface ProjectCardStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  selectedVersion: number;
  manualStatusInput: ProjectVersionManualStatus;
  selectedVersionStatus: string;
  manualProjectStatusOptions: ManualProjectStatusOption[];
  isPending: boolean;
  onManualStatusInputChange: (value: ProjectVersionManualStatus) => void;
  onConfirm: () => void;
}

interface ProjectCardEditTitleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTitle: string;
  editTitleInput: string;
  isPending: boolean;
  onEditTitleInputChange: (value: string) => void;
  onSave: () => void;
}

interface ProjectCardRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  renameSlugInput: string;
  isPending: boolean;
  onRenameSlugInputChange: (value: string) => void;
  onConfirm: () => void;
}

export function ProjectCardStatusDialog({
  open,
  onOpenChange,
  projectSlug,
  selectedVersion,
  manualStatusInput,
  selectedVersionStatus,
  manualProjectStatusOptions,
  isPending,
  onManualStatusInputChange,
  onConfirm,
}: ProjectCardStatusDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Set project status</AlertDialogTitle>
          <AlertDialogDescription>
            Override {projectSlug} v{selectedVersion} with a durable status.
            This is available to organization admins and super admins.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <Select
            value={manualStatusInput}
            onValueChange={(value) =>
              onManualStatusInputChange(value as ProjectVersionManualStatus)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {manualProjectStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {
              manualProjectStatusOptions.find(
                (option) => option.value === manualStatusInput,
              )?.description
            }
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || manualStatusInput === selectedVersionStatus}
            onClick={onConfirm}
          >
            Update status
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ProjectCardEditTitleDialog({
  open,
  onOpenChange,
  currentTitle,
  editTitleInput,
  isPending,
  onEditTitleInputChange,
  onSave,
}: ProjectCardEditTitleDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Edit project title</AlertDialogTitle>
          <AlertDialogDescription>
            Update the display name shown for this project in listings, search,
            and navigation.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Input
            value={editTitleInput}
            onChange={(event) => onEditTitleInputChange(event.target.value)}
            placeholder="Project title"
            autoFocus
            disabled={isPending}
          />
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving title...
            </div>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={
              isPending ||
              !editTitleInput.trim() ||
              editTitleInput.trim() === currentTitle.trim()
            }
            onClick={onSave}
          >
            {isPending ? "Saving..." : "Save title"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ProjectCardRenameDialog({
  open,
  onOpenChange,
  projectSlug,
  renameSlugInput,
  isPending,
  onRenameSlugInputChange,
  onConfirm,
}: ProjectCardRenameDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rename project slug?</AlertDialogTitle>
          <AlertDialogDescription>
            Change <strong>{projectSlug}</strong> to a new URL slug. This
            updates project references across the control plane. This can take a
            while and project actions stay locked until it completes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Input
            value={renameSlugInput}
            onChange={(event) => onRenameSlugInputChange(event.target.value)}
            placeholder="new-project-slug"
            autoFocus
            disabled={isPending}
          />
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Renaming in progress. Please keep this page open.
            </div>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={
              isPending ||
              !renameSlugInput.trim() ||
              renameSlugInput.trim().toLowerCase() === projectSlug.toLowerCase()
            }
            onClick={onConfirm}
          >
            {isPending ? "Renaming..." : "Rename slug"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
