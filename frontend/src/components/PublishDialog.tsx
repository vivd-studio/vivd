import { useState, useEffect } from "react";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Globe,
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  ChevronDown,
  ClipboardCheck,
  RefreshCw,
  Wrench,
  Circle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  version: number;
  onPublished?: () => void;
}

type ChecklistStatus = "pass" | "fail" | "warning" | "skip" | "fixed";

interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  note?: string;
}

interface PrePublishChecklist {
  projectSlug: string;
  version: number;
  runAt: string;
  items: ChecklistItem[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    fixed?: number;
  };
}

const statusConfig: Record<
  ChecklistStatus,
  { icon: typeof CheckCircle2; color: string; bgColor: string }
> = {
  pass: {
    icon: CheckCircle2,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-900/20",
  },
  fail: {
    icon: XCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-900/20",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
  },
  skip: {
    icon: SkipForward,
    color: "text-gray-500 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-800/50",
  },
  fixed: {
    icon: CheckCircle2,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
};

// Preview items shown before checklist is run
const PREVIEW_CHECKLIST_ITEMS = [
  { id: "impressum", label: "Impressum/Imprint page" },
  { id: "privacy", label: "Privacy policy page" },
  { id: "cookie_banner", label: "Cookie consent banner" },
  { id: "sitemap", label: "sitemap.xml file" },
  { id: "robots", label: "robots.txt file" },
  { id: "favicon", label: "Favicon" },
  { id: "404_page", label: "Custom 404 error page" },
  { id: "navigation", label: "Working navigation links" },
  { id: "contact_form", label: "Contact form functionality" },
  { id: "seo_meta", label: "SEO meta tags" },
  { id: "alt_text", label: "Image alt text" },
];

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
  const [checklistOpen, setChecklistOpen] = useState(true);
  const [checklistPhase, setChecklistPhase] = useState<
    "idle" | "saving" | "running"
  >("idle");
  const [fixingItemId, setFixingItemId] = useState<string | null>(null);

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

  // Get saved checklist
  const {
    data: checklistData,
    isLoading: isLoadingChecklist,
    refetch: refetchChecklist,
  } = trpc.agent.getPrePublishChecklist.useQuery(
    { projectSlug, version },
    { enabled: open && !!projectSlug }
  );

  // Run checklist mutation
  const runChecklistMutation = trpc.agent.runPrePublishChecklist.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Checklist complete: ${data.checklist.summary.passed}/${data.checklist.items.length} passed`
      );
      refetchChecklist();
      setChecklistPhase("idle");
      setChecklistOpen(true);
    },
    onError: (error) => {
      toast.error(`Failed to run checklist: ${error.message}`);
      setChecklistPhase("idle");
    },
  });

  const handleRunChecklist = () => {
    setChecklistPhase("saving");
    // Switch to running phase after a brief delay (only if still saving)
    setTimeout(() => {
      setChecklistPhase((current) =>
        current === "saving" ? "running" : current
      );
    }, 500);
    runChecklistMutation.mutate({ projectSlug, version });
  };

  // Fix checklist item mutation
  const fixItemMutation = trpc.agent.fixChecklistItem.useMutation({
    onSuccess: () => {
      toast.success(`Fixed: ${fixingItemId}`);
      refetchChecklist();
      setFixingItemId(null);
    },
    onError: (error) => {
      toast.error(`Failed to fix: ${error.message}`);
      setFixingItemId(null);
    },
  });

  const handleFixItem = (item: ChecklistItem) => {
    setFixingItemId(item.id);
    fixItemMutation.mutate({
      projectSlug,
      version,
      itemId: item.id,
      itemLabel: item.label,
      itemStatus: item.status as "fail" | "warning",
      itemNote: item.note,
    });
  };

  const checklist: PrePublishChecklist | null =
    checklistData?.checklist ?? null;
  const hasChangesSinceCheck = checklistData?.hasChangesSinceCheck ?? true;

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

  const publishMutation = trpc.project.publish.useMutation({
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

  const unpublishMutation = trpc.project.unpublish.useMutation({
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
    publishMutation.mutate({
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
    unpublishMutation.mutate({ slug: projectSlug });
    setShowUnpublishConfirm(false);
  };

  const isPublished = publishStatus?.isPublished;
  const isPending = publishMutation.isPending || unpublishMutation.isPending;

  // Domain validation status
  const getDomainStatus = () => {
    if (!domain || domain.length < 3) return null;
    if (isCheckingDomain) return "checking";
    if (domainCheck?.available) return "available";
    if (domainCheck?.error) return "unavailable";
    return null;
  };

  const domainStatus = getDomainStatus();

  // Checklist summary for badge
  const getChecklistBadge = () => {
    if (!checklist) return null;
    const { passed, failed, warnings } = checklist.summary;
    const total = checklist.items.length;
    if (failed > 0)
      return { variant: "destructive" as const, text: `${failed} issues` };
    if (warnings > 0)
      return { variant: "secondary" as const, text: `${warnings} warnings` };
    return { variant: "default" as const, text: `${passed}/${total} ✓` };
  };

  const checklistBadge = getChecklistBadge();

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

                {/* Pre-Publish Checklist Section */}
                <Collapsible
                  open={checklistOpen}
                  onOpenChange={setChecklistOpen}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      className={`flex items-center justify-between w-full p-3 rounded-lg border transition-colors text-left ${
                        !checklist
                          ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 hover:bg-amber-100/50 dark:hover:bg-amber-900/30"
                          : "bg-muted/30 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardCheck
                          className={`h-4 w-4 ${
                            !checklist
                              ? "text-amber-600 dark:text-amber-400"
                              : ""
                          }`}
                        />
                        <span className="text-sm font-medium">
                          Pre-Publish Checklist
                        </span>
                        {checklistBadge ? (
                          <Badge
                            variant={checklistBadge.variant}
                            className="text-xs"
                          >
                            {checklistBadge.text}
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                          >
                            Not run
                          </Badge>
                        )}
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          checklistOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    {checklistPhase !== "idle" ? (
                      <div className="flex flex-col items-center justify-center py-6 gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <div className="text-center">
                          <p className="text-sm font-medium">
                            {checklistPhase === "saving"
                              ? "Saving snapshot..."
                              : "Running production checks..."}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {checklistPhase === "saving"
                              ? "Creating checkpoint before analysis"
                              : "This may take up to a minute"}
                          </p>
                        </div>
                      </div>
                    ) : checklist ? (
                      <>
                        <p className="text-xs text-muted-foreground px-1">
                          Last run{" "}
                          {formatDistanceToNow(new Date(checklist.runAt))} ago
                        </p>
                        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
                          {checklist.items.map((item) => {
                            const config = statusConfig[item.status];
                            const Icon = config.icon;
                            return (
                              <div
                                key={item.id}
                                className={`flex items-start gap-2 p-2 rounded-md border text-sm ${config.bgColor}`}
                              >
                                <Icon
                                  className={`w-4 h-4 mt-0.5 shrink-0 ${config.color}`}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-xs flex items-center gap-1.5">
                                    {item.label}
                                    {item.status === "fixed" && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                                        Fixed
                                      </span>
                                    )}
                                  </p>
                                  {item.note && (
                                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                      {item.note}
                                    </p>
                                  )}
                                </div>
                                {(item.status === "fail" ||
                                  item.status === "warning") && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleFixItem(item)}
                                    disabled={fixingItemId !== null}
                                    className="shrink-0 h-6 px-2 text-xs hover:bg-primary/10"
                                  >
                                    {fixingItemId === item.id ? (
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    ) : (
                                      <Wrench className="w-3 h-3 mr-1" />
                                    )}
                                    {fixingItemId === item.id
                                      ? "Fixing..."
                                      : "Fix"}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleRunChecklist}
                                  disabled={
                                    checklistPhase !== "idle" ||
                                    fixingItemId !== null ||
                                    !hasChangesSinceCheck
                                  }
                                  className={`w-full ${
                                    !hasChangesSinceCheck
                                      ? "opacity-50 cursor-not-allowed"
                                      : checklist.summary.failed > 0 ||
                                        checklist.summary.warnings > 0
                                      ? "border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                      : ""
                                  }`}
                                >
                                  <RefreshCw className="w-3 h-3 mr-2" />
                                  Re-run Checks
                                </Button>
                              </span>
                            </TooltipTrigger>
                            {!hasChangesSinceCheck && (
                              <TooltipContent>
                                <p>No changes since last check</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                              Verify production readiness
                            </p>
                            <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                              Run automated checks before publishing to catch
                              common issues
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50">
                          {PREVIEW_CHECKLIST_ITEMS.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 py-1.5 px-2 text-xs text-muted-foreground"
                            >
                              <Circle className="w-3 h-3 shrink-0 text-muted-foreground/50" />
                              <span>{item.label}</span>
                            </div>
                          ))}
                        </div>
                        <Button
                          onClick={handleRunChecklist}
                          disabled={
                            checklistPhase !== "idle" || isLoadingChecklist
                          }
                          size="sm"
                          className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          <ClipboardCheck className="w-4 h-4 mr-2" />
                          Run Pre-Publish Checks
                        </Button>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

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
