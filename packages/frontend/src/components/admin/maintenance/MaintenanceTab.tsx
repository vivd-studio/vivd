import { useState } from "react";
import { Wrench, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@vivd/ui";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FormContent } from "@/components/settings/SettingsPageShell";

type MaintenanceAction =
  | "migrateProcessFiles"
  | "migrateProjectMetadataToDb"
  | "exportProjectsToObjectStorage"
  | "thumbnailsMissing";

export function MaintenanceTab() {
  const [confirmAction, setConfirmAction] = useState<MaintenanceAction | null>(
    null,
  );

  const { data: config } = trpc.project.getConfig.useQuery();

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

  const migrateProjectMetadataMutation =
    trpc.project.migrateProjectMetadataToDb.useMutation({
      onSuccess: (data) => {
        toast.success("DB migration completed", {
          description: `Migrated ${data.projectsMigrated}/${data.projectsScanned} projects • ${data.versionsUpserted} versions`,
        });
      },
      onError: (err: any) => {
        toast.error("DB migration failed", {
          description: err?.message || "Unknown error",
        });
      },
    });

  const exportMutation =
    trpc.project.exportAllProjectsToObjectStorage.useMutation({
      onSuccess: (data) => {
        toast.success("Export completed", {
          description: `Exported ${data.versionsExported}/${data.versionsScanned} versions • ${data.filesUploaded} files`,
        });
      },
      onError: (err: any) => {
        toast.error("Export failed", {
          description: err?.message || "Unknown error",
        });
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
    onError: (err: any) => {
      toast.error("Thumbnail regeneration failed", {
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
      case "migrateProjectMetadataToDb":
        return {
          title: "Migrate project metadata to the database?",
          description:
            "This will import manifest/project metadata + publish checklist into Postgres and upload thumbnails to the bucket (if configured). It's safe to run multiple times.",
          confirmLabel: "Migrate to DB",
          isPending: migrateProjectMetadataMutation.isPending,
          onConfirm: () => migrateProjectMetadataMutation.mutate(),
        };
      case "exportProjectsToObjectStorage":
        return {
          title: "Export all projects to object storage?",
          description:
            "This uploads every project version into your S3/R2 bucket under tenants/<tenant>/projects/<slug>/v<version>/source/ so studio machines can hydrate from the bucket.",
          confirmLabel: "Export Projects",
          isPending: exportMutation.isPending,
          onConfirm: () => exportMutation.mutate(),
        };
      case "thumbnailsMissing":
        return {
          title: "Generate missing thumbnails?",
          description:
            "This will generate thumbnails for all completed project versions that don't have one. This may take a while as each thumbnail is processed sequentially.",
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
      <FormContent className="max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-blue-600" />
            System Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {config ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Tenant:</span>
              <code>{config.tenantId}</code>
              <span className="mx-1">•</span>
              <span>GitHub sync:</span>
              <Badge variant={config.github.enabled ? "default" : "secondary"}>
                {config.github.enabled ? "enabled" : "disabled"}
              </Badge>
              {config.github.enabled && config.github.org ? (
                <code>
                  {config.github.org}
                  {config.github.repoPrefix
                    ? ` (prefix: ${config.github.repoPrefix})`
                    : ""}
                </code>
              ) : null}
            </div>
          ) : null}
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
              Migrate project metadata from local files into the database
              (tables <code>project_meta</code>, <code>project_version</code>,{" "}
              <code>project_publish_checklist</code>). If object storage is
              configured, existing <code>.vivd/thumbnail.webp</code> files are
              uploaded and persisted as <code>thumbnail_key</code>.
            </p>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setConfirmAction("migrateProjectMetadataToDb")}
                disabled={migrateProjectMetadataMutation.isPending}
              >
                {migrateProjectMetadataMutation.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}
                Migrate Project Metadata to DB
              </Button>
              {migrateProjectMetadataMutation.data ? (
                <span className="text-sm text-muted-foreground">
                  Migrated {migrateProjectMetadataMutation.data.projectsMigrated}/
                  {migrateProjectMetadataMutation.data.projectsScanned} projects •{" "}
                  {migrateProjectMetadataMutation.data.versionsUpserted} versions •{" "}
                  {migrateProjectMetadataMutation.data.checklistsUpserted} checklists •{" "}
                  {migrateProjectMetadataMutation.data.thumbnailsUploaded} thumbnails
                  {migrateProjectMetadataMutation.data.errors.length
                    ? ` • ${migrateProjectMetadataMutation.data.errors.length} error(s)`
                    : ""}
                </span>
              ) : null}
            </div>
            {migrateProjectMetadataMutation.data?.errors.length ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">Errors</div>
                <ul className="space-y-1 text-muted-foreground">
                  {migrateProjectMetadataMutation.data.errors
                    .slice(0, 5)
                    .map((e, idx) => (
                      <li key={idx}>
                        {e.slug}: {e.error}
                      </li>
                    ))}
                </ul>
                {migrateProjectMetadataMutation.data.errors.length > 5 ? (
                  <div className="text-muted-foreground mt-2">
                    …and {migrateProjectMetadataMutation.data.errors.length - 5} more
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="border-t pt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Export all local project files into your configured S3/R2 bucket so
              studio machines can hydrate a workspace directory on startup.
              Files are uploaded under{" "}
              <code>
                tenants/&lt;tenant&gt;/projects/&lt;slug&gt;/v&lt;version&gt;/source/
              </code>{" "}
              and <code>node_modules</code> is skipped.
            </p>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setConfirmAction("exportProjectsToObjectStorage")}
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}
                Export Projects to Bucket
              </Button>
              {exportMutation.data ? (
                <span className="text-sm text-muted-foreground">
                  Exported {exportMutation.data.versionsExported}/
                  {exportMutation.data.versionsScanned} versions •{" "}
                  {exportMutation.data.filesUploaded} files
                  {exportMutation.data.errors.length ||
                  exportMutation.data.fileErrors.length
                    ? ` • ${
                        exportMutation.data.errors.length +
                        exportMutation.data.fileErrors.length
                      } error(s)`
                    : ""}
                </span>
              ) : null}
            </div>
            {exportMutation.data?.errors.length ||
            exportMutation.data?.fileErrors.length ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">Errors</div>
                <ul className="space-y-1 text-muted-foreground">
                  {(exportMutation.data?.errors ?? [])
                    .slice(0, 3)
                    .map((e, idx) => (
                      <li key={`v-${idx}`}>
                        {e.slug}: {e.error}
                      </li>
                    ))}
                  {(exportMutation.data?.fileErrors ?? [])
                    .slice(0, 2)
                    .map((e, idx) => (
                      <li key={`f-${idx}`}>
                        {e.slug}: {e.file} • {e.error}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="border-t pt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Generate missing project card thumbnails. Thumbnails are captured
              from the preview URL and stored in{" "}
              <code>.vivd/thumbnail.webp</code>. This operation processes
              versions sequentially to avoid overloading the scraper.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => setConfirmAction("thumbnailsMissing")}
                disabled={thumbnailsMutation.isPending}
              >
                {thumbnailsMutation.isPending ? (
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                ) : null}
                Generate Missing Thumbnails
              </Button>
              {thumbnailsMutation.data ? (
                <span className="text-sm text-muted-foreground">
                  Generated {thumbnailsMutation.data.thumbnailsGenerated}/
                  {thumbnailsMutation.data.versionsScanned} versions
                  {thumbnailsMutation.data.errors.length
                    ? ` (${thumbnailsMutation.data.errors.length} error(s))`
                    : ""}
                </span>
              ) : null}
            </div>
            {thumbnailsMutation.data?.errors.length ? (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium mb-2">Errors</div>
                <ul className="space-y-1 text-muted-foreground">
                  {thumbnailsMutation.data.errors.slice(0, 5).map((e, idx) => (
                    <li key={idx}>
                      {e.slug}/v{e.version}: {e.error}
                    </li>
                  ))}
                </ul>
                {thumbnailsMutation.data.errors.length > 5 ? (
                  <div className="text-muted-foreground mt-2">
                    …and {thumbnailsMutation.data.errors.length - 5} more
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
      </FormContent>

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
              variant="destructive"
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
