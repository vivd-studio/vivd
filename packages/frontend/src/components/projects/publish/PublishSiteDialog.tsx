import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Rocket, Loader2, ExternalLink, AlertTriangle, Globe, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

interface PublishSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  version: number;
  onOpenStudio?: () => void;
}

function formatTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${date.toLocaleString()} (${formatDistanceToNow(date, { addSuffix: true })})`;
}

export function PublishSiteDialog({
  open,
  onOpenChange,
  slug,
  version,
  onOpenStudio,
}: PublishSiteDialogProps) {
  const utils = trpc.useUtils();
  const [domain, setDomain] = useState("");
  const [confirmUnpublishOpen, setConfirmUnpublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishStatusQuery = trpc.project.publishStatus.useQuery(
    { slug },
    { enabled: open && !!slug },
  );

  const publishStateQuery = trpc.project.publishState.useQuery(
    { slug, version },
    { enabled: open && !!slug },
  );

  const publishChecklistQuery = trpc.project.publishChecklist.useQuery(
    { slug, version },
    { enabled: open && !!slug },
  );

  useEffect(() => {
    if (!open) return;
    setDomain(publishStatusQuery.data?.domain ?? "");
  }, [open, publishStatusQuery.data?.domain]);

  useEffect(() => {
    if (!open) {
      setPublishError(null);
    }
  }, [open]);

  const normalizedInput = domain.trim();
  const checkDomainQuery = trpc.project.checkDomain.useQuery(
    { domain: normalizedInput, slug },
    {
      enabled: open && normalizedInput.length > 0,
    },
  );

  const publishMutation = trpc.project.publish.useMutation({
    onSuccess: (data) => {
      setPublishError(null);
      toast.success(`Published to ${data.domain}`);
      void Promise.all([
        utils.project.list.invalidate(),
        utils.project.publishStatus.invalidate({ slug }),
        utils.project.publishState.invalidate({ slug, version }),
        utils.project.getExternalPreviewStatus.invalidate({ slug, version }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => {
      const message = error.message || "Failed to publish";
      const detail = error.data?.code === "CONFLICT"
        ? `${message} Refresh status and retry.`
        : message;
      setPublishError(detail);
      toast.error(message);
      void utils.project.publishState.invalidate({ slug, version });
    },
  });

  const unpublishMutation = trpc.project.unpublish.useMutation({
    onSuccess: () => {
      toast.success("Site unpublished");
      setConfirmUnpublishOpen(false);
      void Promise.all([
        utils.project.list.invalidate(),
        utils.project.publishStatus.invalidate({ slug }),
      ]);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to unpublish");
    },
  });

  const state = publishStateQuery.data;
  const publishStatus = publishStatusQuery.data;
  const checklist = publishChecklistQuery.data;
  const publishedVersion =
    publishStatus && "projectVersion" in publishStatus
      ? publishStatus.projectVersion
      : null;

  const unsavedChangesWarning = useMemo(() => {
    if (!state?.studioRunning) return false;
    if (state?.studioHasUnsavedChanges) return true;
    if (state?.studioStateAvailable === false) return true;
    if (!state.publishableCommitHash || !state.lastSyncedCommitHash) return false;
    return state.publishableCommitHash !== state.lastSyncedCommitHash;
  }, [
    state?.studioRunning,
    state?.studioHasUnsavedChanges,
    state?.studioStateAvailable,
    state?.publishableCommitHash,
    state?.lastSyncedCommitHash,
  ]);

  const studioStateUnknownWarning = Boolean(
    state?.studioRunning && state?.studioStateAvailable === false,
  );

  const domainOk = normalizedInput.length > 0 && (checkDomainQuery.data?.available ?? true);
  const readyForPublish = state?.readiness === "ready";
  const publishDisabled =
    publishMutation.isPending ||
    !readyForPublish ||
    !domainOk ||
    !state?.storageEnabled ||
    studioStateUnknownWarning ||
    Boolean(state?.studioHasUnsavedChanges);

  const handlePublish = () => {
    setPublishError(null);
    if (!domainOk) {
      toast.error(checkDomainQuery.data?.error || "Enter a valid domain");
      return;
    }
    publishMutation.mutate({
      slug,
      version,
      domain: normalizedInput,
      expectedCommitHash: state?.publishableCommitHash ?? undefined,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              Publish Site
            </DialogTitle>
            <DialogDescription>
              Make <span className="font-medium">{slug}</span> live at your domain.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Publishing content</span>
                <span className="text-foreground">
                  {state?.sourceKind === "preview" ? "Latest preview build" : "Latest saved files"}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>Version: <span className="text-foreground">v{version}</span></div>
                <div>Prepared: <span className="text-foreground">{formatTimeLabel(state?.builtAt)}</span></div>
              </div>
            </div>

            {state?.readiness === "build_in_progress" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Site build in progress. You can publish once it is ready.
              </div>
            ) : null}

            {state?.readiness === "artifact_not_ready" ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {state.error || "This site is not ready to publish yet."}
              </div>
            ) : null}

            {publishError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {publishError}
              </div>
            ) : null}

            {unsavedChangesWarning ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div className="space-y-2">
                    <div>
                      {studioStateUnknownWarning
                        ? "Studio is active. Open Studio and save before publishing."
                        : "You have unsaved changes in Studio."}
                    </div>
                    {onOpenStudio ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-400 bg-transparent"
                        onClick={onOpenStudio}
                      >
                        Open Studio to save changes
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {checklist?.checklist ? (
              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground mb-1">Checklist</div>
                <div>
                  Passed {checklist.checklist.summary.passed} / {checklist.checklist.items.length}
                  {checklist.stale ? " (stale)" : " (fresh)"}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor={`publish-domain-${slug}`}>Domain</Label>
              <Input
                id={`publish-domain-${slug}`}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                autoComplete="off"
              />
              {normalizedInput.length > 0 && checkDomainQuery.data?.error ? (
                <div className="text-xs text-destructive">{checkDomainQuery.data.error}</div>
              ) : null}
            </div>

            {publishStatus?.isPublished ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    Published at{" "}
                    <span className="font-medium">{publishStatus.domain}</span>
                    {publishStatus.publishedAt ? ` · ${formatTimeLabel(publishStatus.publishedAt)}` : ""}
                  </div>
                  {publishStatus.url ? (
                    <a
                      className="inline-flex items-center gap-1 text-emerald-900 hover:underline"
                      href={publishStatus.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex items-center gap-2">
              {publishStatus?.isPublished ? (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmUnpublishOpen(true)}
                  disabled={unpublishMutation.isPending}
                >
                  {unpublishMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Unpublishing...
                    </>
                  ) : (
                    "Unpublish site"
                  )}
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPublishError(null);
                  void Promise.all([
                    publishStateQuery.refetch(),
                    publishChecklistQuery.refetch(),
                    publishStatusQuery.refetch(),
                  ]);
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh status
              </Button>
              <Button onClick={handlePublish} disabled={publishDisabled}>
                {publishMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <Globe className="h-4 w-4 mr-2" />
                    Publish site
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmUnpublishOpen} onOpenChange={setConfirmUnpublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish site?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove domain routing for <span className="font-medium">{publishStatus?.domain || slug}</span>
              {publishedVersion ? ` (v${publishedVersion})` : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => unpublishMutation.mutate({ slug })}
            >
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
