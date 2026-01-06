import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PrePublishChecklist } from "@/components/publish/PrePublishChecklist";
import { usePrePublishChecklist } from "@/components/publish/usePrePublishChecklist";
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

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  version: number;
  onPublished?: () => void;
}

export function PublishDialog({
  open,
  onOpenChange,
  projectSlug,
  version,
  onPublished,
}: PublishDialogProps) {
  const [domain, setDomain] = useState("");
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);
  const [showPublishWarning, setShowPublishWarning] = useState(false);

  const utils = trpc.useUtils();

  // Get application config (for default domain)
  const { data: config } = trpc.project.getConfig.useQuery();

  // Get current publish status
  const {
    data: publishStatus,
    isLoading: isLoadingStatus,
    isError: isStatusError,
  } = trpc.project.publishStatus.useQuery(
    { slug: projectSlug },
    { enabled: open && !!projectSlug, retry: false }
  );

  const {
    checklist,
    hasChangesSinceCheck,
    isLoadingChecklist,
    runChecklist,
    isRunningChecklist,
    fixChecklistItem,
    fixingItemId,
  } = usePrePublishChecklist({ dialogOpen: open, projectSlug, version });

  // Check domain availability (debounced)
  const { data: domainCheck, isLoading: isCheckingDomain } =
    trpc.project.checkDomain.useQuery(
      { domain, slug: projectSlug },
      {
        enabled: open && domain.length > 2,
        staleTime: 1000,
      }
    );

  // Pre-fill domain: use published domain if already published, otherwise use config domain
  useEffect(() => {
    if (open && publishStatus?.isPublished && publishStatus.domain) {
      setDomain(publishStatus.domain);
    } else if (open && config?.domain) {
      // Use the DOMAIN setting as default for new publishing
      setDomain(config.domain);
    } else if (open) {
      setDomain("");
    }
  }, [open, publishStatus, config]);

  useEffect(() => {
    if (!open) {
      setShowUnpublishConfirm(false);
      setShowPublishWarning(false);
    }
  }, [open]);

  const { mutate: publish, isPending: isPublishing } =
    trpc.project.publish.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      if (data.github?.attempted && !data.github.success) {
        toast.error(
          `GitHub sync failed (published anyway): ${
            data.github.error || "unknown error"
          }`
        );
      }
      utils.project.publishStatus.invalidate({ slug: projectSlug });
      onPublished?.();
    },
    onError: (error) => {
      toast.error(`Failed to publish: ${error.message}`);
    },
  });

  const { mutate: unpublish, isPending: isUnpublishing } =
    trpc.project.unpublish.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.project.publishStatus.invalidate({ slug: projectSlug });
      setDomain("");
    },
    onError: (error) => {
      toast.error(`Failed to unpublish: ${error.message}`);
    },
  });

  const handlePublish = () => {
    if (!domain.trim()) {
      toast.error("Please enter a domain");
      return;
    }
    // Check if there are failed/warning checks
    if (
      checklist &&
      (checklist.summary.failed > 0 || checklist.summary.warnings > 0)
    ) {
      setShowPublishWarning(true);
      return;
    }
    doPublish();
  };

  const doPublish = () => {
    publish({
      slug: projectSlug,
      version,
      domain: domain.trim(),
    });
    setShowPublishWarning(false);
  };

  const handleUnpublish = () => {
    setShowUnpublishConfirm(true);
  };

  const confirmUnpublish = () => {
    unpublish({ slug: projectSlug });
    setShowUnpublishConfirm(false);
  };

  const isPublished = publishStatus?.isPublished;
  const isPending = isPublishing || isUnpublishing;

  // Domain validation status
  const getDomainStatus = () => {
    if (!domain || domain.length < 3) return null;
    if (isCheckingDomain) return "checking";
    if (domainCheck?.available) return "available";
    if (domainCheck?.error) return "unavailable";
    return null;
  };

  const domainStatus = getDomainStatus();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {isPublished ? "Manage Publication" : "Publish to Web"}
            </DialogTitle>
            <DialogDescription>
              {isPublished
                ? "Your site is live. You can update the domain or unpublish."
                : "Make your site available on a custom domain."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {isLoadingStatus && !isStatusError ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4 py-4">
                {/* Current Status Banner */}
                {isPublished && (
                  <div className="flex items-center justify-between p-3 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-400">
                        Published
                      </span>
                    </div>
                    <a
                      href={publishStatus.url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-green-600 hover:text-green-800 dark:text-green-400 flex items-center gap-1"
                    >
                      {publishStatus.domain}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                <PrePublishChecklist
                  dialogOpen={open}
                  checklist={checklist}
                  hasChangesSinceCheck={hasChangesSinceCheck}
                  isLoading={isLoadingChecklist}
                  isRunning={isRunningChecklist}
                  onRun={runChecklist}
                  onFixItem={fixChecklistItem}
                  fixingItemId={fixingItemId}
                />

                {/* Domain Input */}
                <div className="grid gap-2">
                  <Label htmlFor="domain">Domain</Label>
                  <div className="relative">
                    <Input
                      id="domain"
                      placeholder="example.com"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value.toLowerCase())}
                      className="pr-10"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {domainStatus === "checking" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {domainStatus === "available" && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      {domainStatus === "unavailable" && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {domainCheck?.normalizedDomain &&
                      domainCheck.normalizedDomain !== domain && (
                        <>
                          <span>Will use:</span>
                          <Badge variant="secondary" className="text-xs">
                            {domainCheck.normalizedDomain}
                          </Badge>
                        </>
                      )}
                    {domainStatus === "unavailable" && domainCheck?.error && (
                      <span className="text-red-500">{domainCheck.error}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Both {domain || "example.com"} and www.
                    {domain || "example.com"} will point to your site
                  </p>
                </div>

                {/* Info Note */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div className="text-xs text-amber-700 dark:text-amber-400">
                    <p className="font-medium">DNS Configuration Required</p>
                    <p className="mt-1">
                      Point your domain's DNS A record to your server's IP
                      address. HTTPS will be automatically configured.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {isPublished && (
              <Button
                variant="outline"
                onClick={handleUnpublish}
                disabled={isPending || fixingItemId !== null}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Unpublish
              </Button>
            )}
            <Button
              onClick={handlePublish}
              disabled={
                isPending ||
                fixingItemId !== null ||
                !domain.trim() ||
                (domainStatus === "unavailable" && !isPublished)
              }
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isPublished ? "Update" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unpublish Confirmation */}
      <AlertDialog
        open={showUnpublishConfirm}
        onOpenChange={setShowUnpublishConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish Site?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your site from{" "}
              <strong>{publishStatus?.domain}</strong>. The domain will become
              available again and visitors will see an error page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmUnpublish}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Warning for Failed/Warning Checks */}
      <AlertDialog
        open={showPublishWarning}
        onOpenChange={setShowPublishWarning}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Publish with Issues?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {checklist && (
                <>
                  Your pre-publish checklist has{" "}
                  {checklist.summary.failed > 0 && (
                    <strong className="text-red-600">
                      {checklist.summary.failed} failed check
                      {checklist.summary.failed !== 1 ? "s" : ""}
                    </strong>
                  )}
                  {checklist.summary.failed > 0 &&
                    checklist.summary.warnings > 0 &&
                    " and "}
                  {checklist.summary.warnings > 0 && (
                    <strong className="text-amber-600">
                      {checklist.summary.warnings} warning
                      {checklist.summary.warnings !== 1 ? "s" : ""}
                    </strong>
                  )}
                  . Are you sure you want to publish anyway?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={doPublish}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Publish Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
