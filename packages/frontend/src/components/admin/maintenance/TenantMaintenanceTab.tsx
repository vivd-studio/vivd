import { useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type TenantMaintenanceAction = "fixGitignore" | "thumbnailsMissing";

export function TenantMaintenanceTab() {
  const [confirmAction, setConfirmAction] = useState<TenantMaintenanceAction | null>(null);

  const fixGitignoreMutation = trpc.project.fixGitignoreAll.useMutation({
    onSuccess: (data) => {
      toast.success("Gitignore fix completed", {
        description:
          data.versionsFixed > 0
            ? `Fixed ${data.versionsFixed}/${data.versionsScanned} versions`
            : `All ${data.versionsScanned} versions already clean`,
      });
    },
    onError: (error) => {
      toast.error("Gitignore fix failed", { description: error.message });
    },
  });

  const thumbnailsMutation = trpc.project.regenerateAllThumbnails.useMutation({
    onSuccess: (data) => {
      toast.success("Thumbnail regeneration completed", {
        description:
          data.thumbnailsGenerated > 0
            ? `Generated ${data.thumbnailsGenerated} thumbnails (${data.thumbnailsSkipped} skipped)`
            : `All ${data.versionsScanned} versions already have thumbnails`,
      });
    },
    onError: (error) => {
      toast.error("Thumbnail regeneration failed", { description: error.message });
    },
  });

  const confirmConfig = (() => {
    switch (confirmAction) {
      case "fixGitignore":
        return {
          title: "Fix gitignore for all organization projects?",
          description:
            "This untracks build cache directories (.astro, node_modules, dist, etc.) that were accidentally committed.",
          confirmLabel: "Fix Gitignore",
          isPending: fixGitignoreMutation.isPending,
          onConfirm: () => fixGitignoreMutation.mutate(),
        };
      case "thumbnailsMissing":
        return {
          title: "Generate missing thumbnails?",
          description:
            "This generates thumbnails for completed versions in your organization that are missing one.",
          confirmLabel: "Generate Missing",
          isPending: thumbnailsMutation.isPending,
          onConfirm: () => thumbnailsMutation.mutate({ onlyMissing: true }),
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
            Organization Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            These operations run only for your currently active organization.
          </p>

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div>
              <div className="font-medium">Fix Gitignore in All Project Versions</div>
              <p className="text-sm text-muted-foreground">
                Cleans up tracked cache/build directories that should be ignored.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setConfirmAction("fixGitignore")}
              disabled={fixGitignoreMutation.isPending}
            >
              {fixGitignoreMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Fix Gitignore
            </Button>
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div>
              <div className="font-medium">Thumbnails</div>
              <p className="text-sm text-muted-foreground">
                Generate missing thumbnails for completed project versions.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmAction("thumbnailsMissing")}
                disabled={thumbnailsMutation.isPending}
              >
                Generate Missing
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmConfig} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmConfig?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmConfig?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmConfig?.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmConfig?.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmConfig) return;
                confirmConfig.onConfirm();
                setConfirmAction(null);
              }}
            >
              {confirmConfig?.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {confirmConfig?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
