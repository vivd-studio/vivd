import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Organization } from "../types";

type Props = {
  selectedOrg: Organization;
  orgNameForm: string;
  setOrgNameForm: (next: string) => void;
  renamePending: boolean;
  onRename: () => void;
  githubPrefixForm: string;
  setGithubPrefixForm: (next: string) => void;
  savePending: boolean;
  onSave: () => void;
  deletePending: boolean;
  onDelete: () => void;
};

export function SettingsPanel({
  selectedOrg,
  orgNameForm,
  setOrgNameForm,
  renamePending,
  onRename,
  githubPrefixForm,
  setGithubPrefixForm,
  savePending,
  onSave,
  deletePending,
  onDelete,
}: Props) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">Organization name</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            The display name for this organization.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 max-w-sm">
            <Input
              placeholder={selectedOrg.slug}
              value={orgNameForm}
              onChange={(e) => setOrgNameForm(e.target.value)}
            />
          </div>
          <Button
            onClick={onRename}
            disabled={
              renamePending ||
              !orgNameForm.trim() ||
              orgNameForm.trim() === selectedOrg.name
            }
          >
            {renamePending ? "Saving..." : "Save name"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">GitHub repository prefix</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Prefix for auto-created repository names. A trailing "-" is added automatically if missing.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 max-w-sm">
            <Input
              placeholder={selectedOrg.slug}
              value={githubPrefixForm}
              onChange={(e) => setGithubPrefixForm(e.target.value)}
            />
          </div>
          <Button
            onClick={onSave}
            disabled={savePending || githubPrefixForm.trim() === selectedOrg.githubRepoPrefix}
          >
            {savePending ? "Saving..." : "Save prefix"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-destructive/50 bg-card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium text-destructive">Danger zone</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Permanently delete this organization and all its data.
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => setShowDeleteDialog(true)}
          disabled={deletePending || selectedOrg.id === "default"}
        >
          Delete organization
        </Button>
        {selectedOrg.id === "default" && (
          <p className="text-xs text-muted-foreground">
            The default organization cannot be deleted.
          </p>
        )}
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {selectedOrg.name}
              </span>{" "}
              ({selectedOrg.id}) and all associated data including members,
              projects, domains, and usage records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deletePending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete();
                setShowDeleteDialog(false);
              }}
            >
              {deletePending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </span>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
