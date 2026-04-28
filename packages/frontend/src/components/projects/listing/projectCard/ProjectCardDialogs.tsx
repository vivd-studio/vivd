import type { ProjectVersionManualStatus } from "@vivd/shared/types";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vivd/ui";

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

interface ProjectCardDuplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceProjectSlug: string;
  sourceVersion: number;
  duplicateTitleInput: string;
  duplicateSlugInput: string;
  isPending: boolean;
  onDuplicateTitleInputChange: (value: string) => void;
  onDuplicateSlugInputChange: (value: string) => void;
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
          <Panel
            tone="sunken"
            className="rounded-md px-3 py-2 text-xs text-muted-foreground"
          >
            {
              manualProjectStatusOptions.find(
                (option) => option.value === manualStatusInput,
              )?.description
            }
          </Panel>
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

export function ProjectCardDuplicateDialog({
  open,
  onOpenChange,
  sourceProjectSlug,
  sourceVersion,
  duplicateTitleInput,
  duplicateSlugInput,
  isPending,
  onDuplicateTitleInputChange,
  onDuplicateSlugInputChange,
  onConfirm,
}: ProjectCardDuplicateDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Duplicate selected version</AlertDialogTitle>
          <AlertDialogDescription>
            Create a new project from {sourceProjectSlug} v{sourceVersion}.
            The new project starts at v1. Other versions are not copied in this
            first workflow.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="duplicate-title">Project title</FieldLabel>
            <Input
              id="duplicate-title"
              value={duplicateTitleInput}
              onChange={(event) =>
                onDuplicateTitleInputChange(event.target.value)
              }
              placeholder="Project title"
              autoFocus
              disabled={isPending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="duplicate-slug">Project slug</FieldLabel>
            <Input
              id="duplicate-slug"
              value={duplicateSlugInput}
              onChange={(event) =>
                onDuplicateSlugInputChange(event.target.value)
              }
              placeholder="project-copy"
              autoComplete="off"
              disabled={isPending}
            />
            <FieldDescription>
              Lowercase letters, numbers, and hyphens only.
            </FieldDescription>
          </Field>
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Duplicating project...
            </div>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={
              isPending ||
              !duplicateTitleInput.trim() ||
              !duplicateSlugInput.trim()
            }
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {isPending ? "Duplicating..." : "Duplicate as new project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
