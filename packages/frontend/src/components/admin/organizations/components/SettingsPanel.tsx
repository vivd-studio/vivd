import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge, Button, Callout, CalloutDescription, CalloutTitle, Field, FieldDescription, FieldLabel, Input, Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle, StatTile, StatusPill, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@vivd/ui";

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
    <StatTile className="gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </StatTile>
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
      <Panel>
        <PanelHeader>
          <PanelTitle>Identity</PanelTitle>
          <PanelDescription>
            Names and stable identifiers used throughout the control plane.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="space-y-5">
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
                  <StatusPill
                    tone={selectedOrg.status === "active" ? "success" : "danger"}
                    dot
                  >
                    {selectedOrg.status}
                  </StatusPill>
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

          <Panel tone="sunken" className="p-4">
            <Field>
              <FieldLabel htmlFor="org-name">Display name</FieldLabel>
              <FieldDescription>
                Shown in org switchers, project ownership surfaces, and admin
                summaries.
              </FieldDescription>
            </Field>
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
          </Panel>
        </PanelContent>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Repository defaults</PanelTitle>
          <PanelDescription>
            Controls how auto-created GitHub repositories are named for this
            organization.
          </PanelDescription>
        </PanelHeader>
        <PanelContent className="space-y-5">
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

          <Panel tone="sunken" className="p-4">
            <Field>
              <FieldLabel htmlFor="github-prefix">
                GitHub repository prefix
              </FieldLabel>
              <FieldDescription>
                A trailing hyphen is added automatically if needed.
              </FieldDescription>
            </Field>
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
          </Panel>
        </PanelContent>
      </Panel>

      <Panel>
        <PanelHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <PanelTitle>Delete organization</PanelTitle>
              <PanelDescription>
                Remove this organization, its members, projects, domains, and
                usage records from the platform.
              </PanelDescription>
            </div>
            <StatusPill
              tone={selectedOrg.id === "default" ? "neutral" : "danger"}
            >
              {selectedOrg.id === "default" ? "Protected" : "Destructive"}
            </StatusPill>
          </div>
        </PanelHeader>
        <PanelContent className="space-y-4">
          {selectedOrg.id === "default" ? (
            <Callout tone="info" icon={<AlertTriangle />}>
              <CalloutTitle>Default organization is protected.</CalloutTitle>
              <CalloutDescription>
                The default organization stays in place as the platform fallback
                tenant.
              </CalloutDescription>
            </Callout>
          ) : (
            <Callout tone="danger" icon={<AlertTriangle />}>
              <CalloutTitle>This action is permanent.</CalloutTitle>
              <CalloutDescription>
                Delete only when this tenant should no longer exist anywhere in
                the control plane.
              </CalloutDescription>
            </Callout>
          )}

          <Panel tone="sunken" className="p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Deletion scope
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedOrg.id === "default"
                    ? "Deletion stays unavailable because this tenant anchors the platform fallback path."
                    : "Deletion removes all associated members, domains, projects, and usage history."}
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
                disabled={deletePending || selectedOrg.id === "default"}
              >
                Delete organization
              </Button>
            </div>
          </Panel>
        </PanelContent>
      </Panel>

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
