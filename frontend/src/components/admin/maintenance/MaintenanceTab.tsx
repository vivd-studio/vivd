import { useState } from "react";
import { Wrench, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type MaintenanceAction =
  | "migrateProcessFiles"
  | "templateAddMissing"
  | "templateOverwrite"
  | "fixGitignore";

export function MaintenanceTab() {
  const [confirmAction, setConfirmAction] = useState<MaintenanceAction | null>(
    null,
  );

  const migrateMutation = trpc.project.migrateVivdProcessFiles.useMutation({
    onSuccess: (data) => {
      toast.success("Migration completed", {
        description: `Touched ${data.versionsTouched}/${data.versionsScanned} versions`,
      });
    },
    onError: (err: any) => {
      toast.error("Migration failed", {
        description: err?.message || "Unknown error",
      });
    },
  });

  const templateFilesMutation =
    trpc.project.migrateProjectTemplateFiles.useMutation({
      onSuccess: (data) => {
        toast.success("Template files updated", {
          description: `Touched ${data.versionsTouched}/${data.versionsScanned} versions`,
        });
      },
      onError: (err: any) => {
        toast.error("Template migration failed", {
          description: err?.message || "Unknown error",
        });
      },
    });

  const fixGitignoreMutation = trpc.project.fixGitignoreAll.useMutation({
    onSuccess: (data) => {
      toast.success("Gitignore fix completed", {
        description:
          data.versionsFixed > 0
            ? `Fixed ${data.versionsFixed}/${data.versionsScanned} versions (untracked: ${data.totalUntracked.join(", ")})`
            : `All ${data.versionsScanned} versions already clean`,
      });
    },
    onError: (err: any) => {
      toast.error("Gitignore fix failed", {
        description: err?.message || "Unknown error",
      });
    },
  });

  const confirmConfig = (() => {
    switch (confirmAction) {
      case "migrateProcessFiles":
        return {
          title: "Run migration for all projects?",
          description:
            "This will move vivd process files into .vivd/ for all existing project versions.",
          confirmLabel: "Run Migration",
          isPending: migrateMutation.isPending,
          onConfirm: () => migrateMutation.mutate(),
        };
      case "templateAddMissing":
        return {
          title: "Add missing template files?",
          description:
            "This will add missing template files for all projects/versions.",
          confirmLabel: "Add Missing Files",
          isPending: templateFilesMutation.isPending,
          onConfirm: () => templateFilesMutation.mutate({ overwrite: false }),
        };
      case "templateOverwrite":
        return {
          title: "Overwrite template files?",
          description:
            "This will overwrite template files for all projects/versions and replace existing AGENTS.md files.",
          confirmLabel: "Overwrite Files",
          isPending: templateFilesMutation.isPending,
          onConfirm: () => templateFilesMutation.mutate({ overwrite: true }),
        };
      case "fixGitignore":
        return {
          title: "Fix gitignore for all projects?",
          description:
            "This will untrack build cache directories (.astro, node_modules, dist, etc.) that were accidentally committed. Changes will be committed automatically.",
          confirmLabel: "Fix Gitignore",
          isPending: fixGitignoreMutation.isPending,
          onConfirm: () => fixGitignoreMutation.mutate(),
        };
      default:
        return null;
    }
  })();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-blue-600" />
            System Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Move vivd process files (like <code>project.json</code>,{" "}
            <code>website_text.txt</code>, screenshots) into the hidden{" "}
            <code>.vivd/</code> folder for all existing projects.
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => setConfirmAction("migrateProcessFiles")}
              disabled={migrateMutation.isPending}
            >
              {migrateMutation.isPending ? (
                <Loader2 className="animate-spin h-4 w-4 mr-2" />
              ) : null}
              Run Migration
            </Button>
            {migrateMutation.data ? (
              <span className="text-sm text-muted-foreground">
                Touched {migrateMutation.data.versionsTouched}/
                {migrateMutation.data.versionsScanned} versions
                {migrateMutation.data.errors.length
                  ? ` • ${migrateMutation.data.errors.length} error(s)`
                  : ""}
              </span>
            ) : null}
          </div>
          {migrateMutation.data?.errors.length ? (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium mb-2">Errors</div>
              <ul className="space-y-1 text-muted-foreground">
                {migrateMutation.data.errors.slice(0, 5).map((e, idx) => (
                  <li key={idx}>
                    {e.slug}: {e.error}
                  </li>
                ))}
              </ul>
              {migrateMutation.data.errors.length > 5 ? (
                <div className="text-muted-foreground mt-2">
                  …and {migrateMutation.data.errors.length - 5} more
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="border-t pt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Ensure project template files (currently <code>AGENTS.md</code>)
              exist in every project version. Use overwrite to update all
              existing <code>AGENTS.md</code> files after changing the template.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => setConfirmAction("templateAddMissing")}
                disabled={templateFilesMutation.isPending}
              >
                {templateFilesMutation.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}
                Add Missing Template Files
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmAction("templateOverwrite")}
                disabled={templateFilesMutation.isPending}
              >
                {templateFilesMutation.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}
                Overwrite & Update Template Files
              </Button>
              {templateFilesMutation.data ? (
                <span className="text-sm text-muted-foreground">
                  Wrote {templateFilesMutation.data.written["AGENTS.md"]}/
                  {templateFilesMutation.data.versionsScanned} versions
                  {templateFilesMutation.data.errors.length
                    ? ` • ${templateFilesMutation.data.errors.length} error(s)`
                    : ""}
                </span>
              ) : null}
            </div>
            {templateFilesMutation.data?.errors.length ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">Errors</div>
                <ul className="space-y-1 text-muted-foreground">
                  {templateFilesMutation.data.errors.slice(0, 5).map((e, idx) => (
                    <li key={idx}>
                      {e.slug}: {e.error}
                    </li>
                  ))}
                </ul>
                {templateFilesMutation.data.errors.length > 5 ? (
                  <div className="text-muted-foreground mt-2">
                    …and {templateFilesMutation.data.errors.length - 5} more
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="border-t pt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Fix gitignore issues by untracking build cache directories (
              <code>.astro</code>, <code>node_modules</code>, <code>dist</code>,
              etc.) that were accidentally committed before being added to{" "}
              <code>.gitignore</code>.
            </p>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setConfirmAction("fixGitignore")}
                disabled={fixGitignoreMutation.isPending}
              >
                {fixGitignoreMutation.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}
                Fix Gitignore (All Projects)
              </Button>
              {fixGitignoreMutation.data ? (
                <span className="text-sm text-muted-foreground">
                  Fixed {fixGitignoreMutation.data.versionsFixed}/
                  {fixGitignoreMutation.data.versionsScanned} versions
                  {fixGitignoreMutation.data.errors.length
                    ? ` • ${fixGitignoreMutation.data.errors.length} error(s)`
                    : ""}
                </span>
              ) : null}
            </div>
            {fixGitignoreMutation.data?.errors.length ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">Errors</div>
                <ul className="space-y-1 text-muted-foreground">
                  {fixGitignoreMutation.data.errors.slice(0, 5).map((e, idx) => (
                    <li key={idx}>
                      {e.slug}/v{e.version}: {e.error}
                    </li>
                  ))}
                </ul>
                {fixGitignoreMutation.data.errors.length > 5 ? (
                  <div className="text-muted-foreground mt-2">
                    …and {fixGitignoreMutation.data.errors.length - 5} more
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmConfig?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmConfig?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmConfig?.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmConfig?.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                confirmConfig?.onConfirm();
                setConfirmAction(null);
              }}
            >
              {confirmConfig?.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working...
                </span>
              ) : (
                confirmConfig?.confirmLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
