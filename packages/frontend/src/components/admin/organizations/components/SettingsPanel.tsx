import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ReadonlyFieldProps = {
  label: string;
  value: ReactNode;
  helper: string;
};

function ReadonlyField({ label, value, helper }: ReadonlyFieldProps) {
  return (
    <div className="rounded-lg border bg-background/80 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
      <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

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

  const repoPrefixPreview = useMemo(() => {
    const rawPrefix =
      githubPrefixForm.trim() ||
      selectedOrg.githubRepoPrefix?.trim() ||
      selectedOrg.slug;

    return rawPrefix.endsWith("-") ? rawPrefix : `${rawPrefix}-`;
  }, [githubPrefixForm, selectedOrg.githubRepoPrefix, selectedOrg.slug]);

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="pb-4">
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Names and stable identifiers used throughout the control plane.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-3 md:grid-cols-3">
            <ReadonlyField
              label="Slug"
              value={<span className="font-mono text-sm">{selectedOrg.slug}</span>}
              helper="Used in URLs, org switching, and tenant scoping."
            />
            <ReadonlyField
              label="Organization ID"
              value={<span className="font-mono text-sm">{selectedOrg.id}</span>}
              helper="Stable internal identifier for admin and backend workflows."
            />
            <ReadonlyField
              label="Status"
              value={
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      selectedOrg.status === "active" ? "default" : "destructive"
                    }
                  >
                    {selectedOrg.status}
                  </Badge>
                  {selectedOrg.id === "default" ? (
                    <Badge variant="outline">Default</Badge>
                  ) : null}
                </div>
              }
              helper={
                selectedOrg.id === "default"
                  ? "The default org remains available as the platform fallback tenant."
                  : "Standard org with its own members, projects, domains, and limits."
              }
            />
          </dl>

          <div className="rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="org-name">Display name</Label>
              <p className="text-sm text-muted-foreground">
                Shown in org switchers, project ownership surfaces, and admin
                summaries.
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
              <div className="max-w-xl flex-1">
                <Input
                  id="org-name"
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
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="pb-4">
          <CardTitle>Repository defaults</CardTitle>
          <CardDescription>
            Controls how auto-created GitHub repositories are named for this
            organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-3 md:grid-cols-2">
            <ReadonlyField
              label="Current prefix"
              value={
                selectedOrg.githubRepoPrefix ? (
                  <span className="font-mono text-sm">
                    {selectedOrg.githubRepoPrefix}
                  </span>
                ) : (
                  "Uses slug fallback"
                )
              }
              helper="Saved default used when new project repositories are created."
            />
            <ReadonlyField
              label="Generated pattern"
              value={
                <span className="font-mono text-sm">
                  {repoPrefixPreview}
                  {"<project-slug>"}
                </span>
              }
              helper="Preview of the repository naming pattern that will be generated."
            />
          </dl>

          <div className="rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="github-prefix">GitHub repository prefix</Label>
              <p className="text-sm text-muted-foreground">
                A trailing hyphen is added automatically if needed.
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
              <div className="max-w-xl flex-1">
                <Input
                  id="github-prefix"
                  placeholder={selectedOrg.slug}
                  value={githubPrefixForm}
                  onChange={(e) => setGithubPrefixForm(e.target.value)}
                />
              </div>
              <Button
                onClick={onSave}
                disabled={
                  savePending ||
                  githubPrefixForm.trim() === selectedOrg.githubRepoPrefix
                }
              >
                {savePending ? "Saving..." : "Save prefix"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Delete organization</CardTitle>
          <CardDescription>
            Remove this organization, its members, projects, domains, and usage
            records from the platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">This action is permanent.</p>
            <p className="mt-1 text-muted-foreground">
              Delete only when this tenant should no longer exist anywhere in the
              control plane.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {selectedOrg.id === "default"
                ? "The default organization stays in place as the platform fallback tenant."
                : "Deletion removes all associated members, domains, projects, and usage history."}
            </div>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
              disabled={deletePending || selectedOrg.id === "default"}
            >
              Delete organization
            </Button>
          </div>
        </CardContent>
      </Card>

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
              variant="destructive"
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
