import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InteractiveSurface,
  InteractiveSurfaceButton,
} from "@/components/ui/interactive-surface";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  History,
  RotateCcw,
  GitCommit,
  Trash2,
  Save,
  Loader2,
  Globe,
  Wand2,
  Github,
  RefreshCw,
  ArrowDownToLine,
  AlertTriangle,
  Copy,
  ChevronDown,
} from "lucide-react";
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
import { POLLING_BACKGROUND } from "@/app/config/polling";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
  parents: string[];
}

interface VersionHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  version: number;
  onLoadVersion: (hash: string) => void;
  isLoadingVersion: boolean;
  loadingVersionHash: string | null;
  onRefresh?: () => void;
}

export function VersionHistoryPanel({
  open,
  onOpenChange,
  projectSlug,
  version,
  onLoadVersion,
  isLoadingVersion,
  loadingVersionHash,
  onRefresh,
}: VersionHistoryPanelProps) {
  const utils = trpc.useUtils();

  const {
    data: historyData,
    isLoading: historyLoading,
    isFetching: historyFetching,
  } = trpc.project.gitHistory.useQuery(
    { slug: projectSlug, version },
    { enabled: open && !!projectSlug }
  );

  const { data: changesData, isFetching: changesFetching } =
    trpc.project.gitHasChanges.useQuery(
      { slug: projectSlug, version },
      { enabled: open && !!projectSlug, refetchInterval: POLLING_BACKGROUND }
    );

  const { data: workingCommitData, isFetching: workingCommitFetching } =
    trpc.project.gitWorkingCommit.useQuery(
      { slug: projectSlug, version },
      { enabled: open && !!projectSlug }
    );

  // Get publish status to show "Published" badge
  const { data: publishStatus } = trpc.project.publishStatus.useQuery(
    { slug: projectSlug },
    { enabled: open && !!projectSlug }
  );

  const {
    data: gitHubSyncStatus,
    isFetching: gitHubSyncFetching,
    refetch: refetchGitHubSyncStatus,
  } = trpc.project.gitHubSyncStatus.useQuery(
    { slug: projectSlug, version },
    { enabled: open && !!projectSlug }
  );

  const [showLoadWarning, setShowLoadWarning] = useState(false);
  const [pendingLoadHash, setPendingLoadHash] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showForceSyncConfirm, setShowForceSyncConfirm] = useState(false);
  const [changedFilesOpen, setChangedFilesOpen] = useState(false);
  const [gitHubSyncOpen, setGitHubSyncOpen] = useState(false);

  // Save State
  const [commitMessage, setCommitMessage] = useState("");

  const commitCount = Math.max(
    historyData?.totalCommits ?? 0,
    historyData?.commits?.length ?? 0
  );

  // Default Commit Message
  useEffect(() => {
    if (open) {
      const nextVersionNumber = commitCount + 1;
      setCommitMessage(`Version ${nextVersionNumber}`);
    }
  }, [open, commitCount]);

  useEffect(() => {
    if (!open) {
      setChangedFilesOpen(false);
      setGitHubSyncOpen(false);
    }
  }, [open]);

  const saveMutation = trpc.project.gitSave.useMutation({
    onSuccess: (data) => {
      if (data.noChanges) {
        toast.info("No changes to save");
        setCommitMessage(`Version ${commitCount + 1}`);
      } else {
        toast.success(data.message);
        setCommitMessage(`Version ${commitCount + 2}`);
        // Invalidate queries to refresh history
        utils.project.gitHistory.invalidate({ slug: projectSlug, version });
        utils.project.gitHasChanges.invalidate({ slug: projectSlug, version });
        utils.project.gitWorkingCommit.invalidate({
          slug: projectSlug,
          version,
        });
        utils.project.gitHubSyncStatus.invalidate({ slug: projectSlug, version });
        onRefresh?.();
      }
    },
    onError: (error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  const handleSave = () => {
    if (!commitMessage.trim()) {
      toast.error("Please enter a snapshot name");
      return;
    }
    saveMutation.mutate({
      slug: projectSlug,
      version,
      message: commitMessage.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const discardMutation = trpc.project.gitDiscardChanges.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.project.gitHasChanges.invalidate({ slug: projectSlug, version });
      utils.project.gitHubSyncStatus.invalidate({ slug: projectSlug, version });
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Failed to discard: ${error.message}`);
    },
  });

  const gitHubPullMutation = trpc.project.gitHubPullFastForward.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      void Promise.all([
        utils.project.gitHistory.invalidate({ slug: projectSlug, version }),
        utils.project.gitHasChanges.invalidate({ slug: projectSlug, version }),
        utils.project.gitWorkingCommit.invalidate({ slug: projectSlug, version }),
        utils.project.gitHubSyncStatus.invalidate({ slug: projectSlug, version }),
      ]);
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`GitHub pull failed: ${error.message}`);
    },
  });

  const gitHubForceSyncMutation = trpc.project.gitHubForceSync.useMutation({
    onSuccess: (data) => {
      toast.success(data.message, {
        description: data.backupTag
          ? `Backup tag: ${data.backupTag}`
          : undefined,
      });
      setShowForceSyncConfirm(false);
      void Promise.all([
        utils.project.gitHistory.invalidate({ slug: projectSlug, version }),
        utils.project.gitHasChanges.invalidate({ slug: projectSlug, version }),
        utils.project.gitWorkingCommit.invalidate({ slug: projectSlug, version }),
        utils.project.gitHubSyncStatus.invalidate({ slug: projectSlug, version }),
      ]);
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`GitHub force sync failed: ${error.message}`);
    },
  });

  const commits = historyData?.commits || [];
  const hasUncommittedChanges = changesData?.hasChanges || false;
  const changedFiles = changesData?.changedFiles || [];
  const workingCommitHash = workingCommitData?.hash || null;
  const headCommit = commits[0] || null;
  const workingCommit = workingCommitHash
    ? commits.find((c: CommitInfo) => c.hash === workingCommitHash) || null
    : null;
  const viewingOlderSnapshot = Boolean(
    headCommit?.hash &&
      workingCommitHash &&
      workingCommitHash !== headCommit.hash
  );
  // Standalone studio publishes by tag; commit hash is not tracked here.
  const publishedCommitHash: string | null = null;
  const isRefreshingAfterSave =
    historyFetching || changesFetching || workingCommitFetching;
  const isSaving = saveMutation.isPending || isRefreshingAfterSave;

  const restoreMutation = trpc.project.gitSave.useMutation({
    onSuccess: (data) => {
      if (data.noChanges) {
        toast.info("Nothing to restore");
        setShowRestoreConfirm(false);
        return;
      }

      toast.success("Snapshot restored");
      setShowRestoreConfirm(false);

      void Promise.all([
        utils.project.gitHistory.invalidate({ slug: projectSlug, version }),
        utils.project.gitHasChanges.invalidate({ slug: projectSlug, version }),
        utils.project.gitWorkingCommit.invalidate({ slug: projectSlug, version }),
        utils.project.gitHubSyncStatus.invalidate({ slug: projectSlug, version }),
      ]);
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Failed to restore snapshot: ${error.message}`);
    },
  });

  const gitOperationInFlight =
    isLoadingVersion ||
    saveMutation.isPending ||
    discardMutation.isPending ||
    restoreMutation.isPending ||
    gitHubPullMutation.isPending ||
    gitHubForceSyncMutation.isPending;

  const handleDiscard = () => {
    if (gitOperationInFlight) return;
    setShowDiscardConfirm(true);
  };

  const formatDate = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  const handleLoadCommit = (hash: string) => {
    if (gitOperationInFlight) return;
    if (hasUncommittedChanges) {
      setPendingLoadHash(hash);
      setShowLoadWarning(true);
      return;
    }
    onLoadVersion(hash);
  };

  const handleRestoreSnapshot = () => {
    if (gitOperationInFlight) return;
    const snapshotName = workingCommit?.message?.trim() || "Snapshot";
    restoreMutation.mutate({
      slug: projectSlug,
      version,
      message: `Restored: ${snapshotName}`,
    });
  };

  const gitHubStatusBadge = (() => {
    const status = gitHubSyncStatus;
    if (!status) {
      return (
        <Badge variant="outline" className="text-[10px] h-5 px-1.5">
          Loading
        </Badge>
      );
    }

    if (!status.enabled) {
      return (
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
          Disabled
        </Badge>
      );
    }

    if (!status.configured) {
      return (
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
          Not configured
        </Badge>
      );
    }

    if (status.fetchError) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] h-5 px-1.5 text-red-700 border-red-200 bg-red-50"
        >
          Error
        </Badge>
      );
    }

    if (status.hasUncommittedChanges) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] h-5 px-1.5 text-amber-700 border-amber-200 bg-amber-50"
        >
          Local changes
        </Badge>
      );
    }

    if (status.workingCommitPinned) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] h-5 px-1.5 text-amber-700 border-amber-200 bg-amber-50"
        >
          Older snapshot
        </Badge>
      );
    }

    if (status.diverged) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] h-5 px-1.5 text-purple-700 border-purple-200 bg-purple-50"
        >
          Diverged
        </Badge>
      );
    }

    if ((status.behind ?? 0) > 0 && (status.ahead ?? 0) === 0) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] h-5 px-1.5 text-blue-700 border-blue-200 bg-blue-50"
        >
          Behind {status.behind}
        </Badge>
      );
    }

    if ((status.ahead ?? 0) > 0 && (status.behind ?? 0) === 0) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] h-5 px-1.5 text-slate-700 border-slate-200 bg-slate-50"
        >
          Ahead {status.ahead}
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="text-[10px] h-5 px-1.5">
        Up to date
      </Badge>
    );
  })();

  const showGitHubSync = Boolean(gitHubSyncStatus?.uiAllowed);
  const gitHubBusy = gitOperationInFlight;
  const pullAllowed = Boolean(gitHubSyncStatus?.pull.allowed);
  const forceAllowed = Boolean(gitHubSyncStatus?.forceSync.allowed);
  const pullDisabled = gitHubBusy || gitHubSyncFetching || !pullAllowed;
  const forceDisabled = gitHubBusy || gitHubSyncFetching || !forceAllowed;

  const handleCopyGitHubSshUrl = () => {
    if (gitOperationInFlight) return;
    const url = gitHubSyncStatus?.sshUrl;
    if (!url) return;
    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard is not available");
      return;
    }

    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Copied GitHub SSH URL"))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to copy GitHub SSH URL", { description: message });
      });
  };

  const gitHubSummaryText = (() => {
    const status = gitHubSyncStatus;
    if (!status) return "Loading status";
    if (!status.enabled) return "GitHub sync disabled";
    if (!status.configured) return "GitHub sync not configured";
    if (status.fetchError) return status.fetchError;
    if (status.remoteRepoExists === false) return "GitHub repo not found";
    if (status.workingCommitPinned) return "Viewing older snapshot";
    if (status.hasUncommittedChanges) return "Local uncommitted changes";
    if (typeof status.ahead === "number" && typeof status.behind === "number") {
      if (status.ahead === 0 && status.behind === 0) return "Up to date with GitHub";
      return `ahead ${status.ahead} • behind ${status.behind}`;
    }
    return "Status available";
  })();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Snapshots
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 flex flex-col h-[calc(100vh-120px)] gap-4">
          {viewingOlderSnapshot && !hasUncommittedChanges ? (
            <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-amber-900">
                    You're viewing an older snapshot
                  </div>
                  <div className="text-xs text-amber-800">
                    Restore this snapshot to make it your latest version. This helps ensure
                    publishing matches what you're viewing.
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 text-amber-700 border-amber-300 bg-white/60"
                >
                  Older Snapshot
                </Badge>
              </div>

              <div className="text-xs text-amber-900/80 space-y-1">
                {workingCommit ? (
                  <div>
                    Viewing: <span className="font-medium">{workingCommit.message}</span>{" "}
                    <span className="text-amber-800">
                      · {formatDate(workingCommit.date)}
                    </span>
                  </div>
                ) : null}
                {headCommit ? (
                  <div>
                    Latest: <span className="font-medium">{headCommit.message}</span>{" "}
                    <span className="text-amber-800">· {formatDate(headCommit.date)}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="bg-amber-700 hover:bg-amber-800 text-white"
                  onClick={() => setShowRestoreConfirm(true)}
                  disabled={gitOperationInFlight || isSaving}
                >
                  {restoreMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Restoring...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Restore Snapshot
                    </>
                  )}
                </Button>
                {headCommit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleLoadCommit(headCommit.hash)}
                    disabled={gitOperationInFlight || isSaving}
                  >
                    {isLoadingVersion && loadingVersionHash === headCommit.hash ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Back to Latest
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* GitHub Sync Section (super-admin only for now) */}
          {showGitHubSync ? (
            <div className="p-4 rounded-lg border bg-card shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Github className="h-4 w-4 text-muted-foreground" />
                  <div className="text-sm font-semibold">GitHub Sync</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => void refetchGitHubSyncStatus()}
                    disabled={gitHubBusy || gitHubSyncFetching}
                    title="Refresh GitHub status"
                  >
                    {gitHubSyncFetching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  {gitHubStatusBadge}
                </div>
              </div>

              <Collapsible open={gitHubSyncOpen} onOpenChange={setGitHubSyncOpen}>
                <CollapsibleTrigger asChild>
                  <InteractiveSurfaceButton
                    variant="choice"
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left"
                  >
                    <div className="min-w-0">
                      {gitHubSyncStatus?.repoFullName ? (
                        <div
                          className="text-xs font-medium truncate"
                          title={gitHubSyncStatus.repoFullName}
                        >
                          {gitHubSyncStatus.repoFullName}
                        </div>
                      ) : (
                        <div className="text-xs font-medium">Repository status</div>
                      )}
                      <div className="text-[11px] text-muted-foreground truncate">
                        {gitHubSummaryText}
                      </div>
                    </div>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                        gitHubSyncOpen ? "rotate-180" : ""
                      }`}
                    />
                  </InteractiveSurfaceButton>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <div className="text-xs text-muted-foreground space-y-1">
                    {gitHubSyncStatus?.repoFullName ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <span>Repo:</span> <code>{gitHubSyncStatus.repoFullName}</code>
                      </div>
                    ) : null}
                    {gitHubSyncStatus?.sshUrl ? (
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="shrink-0">SSH:</span>
                        <code
                          className="flex-1 min-w-0 truncate"
                          title={gitHubSyncStatus.sshUrl}
                        >
                          {gitHubSyncStatus.sshUrl}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={handleCopyGitHubSshUrl}
                          disabled={gitOperationInFlight}
                          title="Copy SSH URL"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                    {gitHubSyncStatus?.configured &&
                    gitHubSyncStatus?.remoteRepoExists === false ? (
                      <div className="flex items-start gap-2 text-red-700">
                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                        <span>GitHub repo not found for this project version.</span>
                      </div>
                    ) : null}
                    {gitHubSyncStatus?.configured && gitHubSyncStatus?.fetchError ? (
                      <div className="flex items-start gap-2 text-red-700">
                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                        <span>{gitHubSyncStatus.fetchError}</span>
                      </div>
                    ) : null}
                    {gitHubSyncStatus?.ahead !== null &&
                    gitHubSyncStatus?.ahead !== undefined &&
                    gitHubSyncStatus?.behind !== null &&
                    gitHubSyncStatus?.behind !== undefined ? (
                      <div>
                        Local: ahead {gitHubSyncStatus.ahead} • behind{" "}
                        {gitHubSyncStatus.behind}
                      </div>
                    ) : null}
                    {gitHubSyncStatus?.lastFetchedAt ? (
                      <div>Checked: {formatDate(gitHubSyncStatus.lastFetchedAt)}</div>
                    ) : null}
                    {gitHubSyncStatus && !gitHubSyncStatus.enabled ? (
                      <div>
                        GitHub sync is disabled in this studio environment.
                      </div>
                    ) : null}
                    {gitHubSyncStatus?.enabled && !gitHubSyncStatus?.configured ? (
                      <div>
                        Configure <code>GITHUB_ORG</code> and <code>GITHUB_TOKEN</code>{" "}
                        to enable pulls.
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        gitHubPullMutation.mutate({ slug: projectSlug, version })
                      }
                      disabled={pullDisabled}
                    >
                      {gitHubPullMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowDownToLine className="h-4 w-4 mr-2" />
                      )}
                      Pull
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowForceSyncConfirm(true)}
                      disabled={forceDisabled}
                      className="border-red-200 text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      {gitHubForceSyncMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 mr-2" />
                      )}
                      Force sync
                    </Button>
                  </div>

                  {!pullAllowed && gitHubSyncStatus?.pull.reason ? (
                    <div className="text-xs text-muted-foreground">
                      Pull disabled: {gitHubSyncStatus.pull.reason}
                    </div>
                  ) : null}
                  {!forceAllowed && gitHubSyncStatus?.forceSync.reason ? (
                    <div className="text-xs text-muted-foreground">
                      Force sync disabled: {gitHubSyncStatus.forceSync.reason}
                    </div>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : null}

          {/* Create Snapshot Section */}
          {hasUncommittedChanges && (
            <div className="p-4 rounded-lg border bg-card shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="snapshot-message" className="font-semibold">
                  New Snapshot
                </Label>
                <Badge
                  variant="outline"
                  className="text-amber-600 border-amber-200 bg-amber-50"
                >
                  Unsaved Changes
                </Badge>
              </div>

              <div className="flex gap-2">
                <Input
                  id="snapshot-message"
                  placeholder="Snapshot name..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1"
                  disabled={gitOperationInFlight}
                />
                <Button
                  onClick={handleSave}
                  disabled={gitOperationInFlight || isSaving || !commitMessage.trim()}
                  size="icon"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {changedFiles.length > 0 ? (
                <Collapsible open={changedFilesOpen} onOpenChange={setChangedFilesOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>
                        {changedFiles.length} changed file
                        {changedFiles.length === 1 ? "" : "s"}
                      </span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${
                          changedFilesOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="max-h-32 overflow-y-auto rounded-md border bg-muted/30 px-2 py-1.5 space-y-1">
                      {changedFiles.map((filePath) => (
                        <div
                          key={filePath}
                          className="font-mono text-[11px] leading-4 text-muted-foreground break-all"
                          title={filePath}
                        >
                          {filePath}
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}

              <div className="flex justify-between items-center pt-1">
                <span className="text-xs text-muted-foreground">
                  Create a version point you can return to
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscard}
                  disabled={gitOperationInFlight}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 h-6 px-2 text-xs"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Discard Changes
                </Button>
              </div>
            </div>
          )}

          {/* Commit list */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-sm font-medium text-muted-foreground mb-2 px-1">
              History
            </h3>
            <ScrollArea className="flex-1 -mr-4 pr-4">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : commits.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GitCommit className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No snapshots yet</p>
                  <p className="text-xs mt-1">
                    Make changes and save to create your first snapshot
                  </p>
                </div>
              ) : (
                <div className="relative pl-4 space-y-6">
                  {/* Vertical timeline line */}
                  <div className="absolute left-[21px] top-2 bottom-2 w-px bg-border" />

                  {commits.map((commit: CommitInfo, index: number) => {
                    const isCurrent = workingCommitHash === commit.hash;
                    const isLatest =
                      index === 0 && workingCommitHash !== commit.hash;
                    const isHead = index === 0;
                    const isLoadingThisCommit =
                      isLoadingVersion && loadingVersionHash === commit.hash;

                    return (
                      <div key={commit.hash} className="relative pl-6">
                        {/* Timeline Dot */}
                        <div
                          className={`absolute left-[13px] top-[14px] h-4 w-4 rounded-full border-2 z-10 bg-background ${
                            isCurrent
                              ? "border-green-500 bg-green-500/20"
                              : isHead
                              ? "border-primary"
                              : "border-muted-foreground"
                          }`}
                        >
                          {isCurrent && (
                            <div className="absolute inset-0.5 rounded-full bg-green-500 animate-pulse" />
                          )}
                        </div>

                        <InteractiveSurface
                          variant="choice"
                          className="rounded-lg p-3 hover:bg-accent/50"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span
                                  className="font-mono text-[10px] text-muted-foreground bg-muted px-1 rounded"
                                  title={commit.hash}
                                >
                                  {commit.shortHash}
                                </span>
                                {isCurrent && (
                                  <Badge
                                    variant="default"
                                    className="text-[10px] h-5 px-1.5 bg-green-600 hover:bg-green-700"
                                  >
                                    Current
                                  </Badge>
                                )}
                                {isLatest && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] h-5 px-1.5"
                                  >
                                    Latest
                                  </Badge>
                                )}
                                {publishedCommitHash === commit.hash && (
                                  <Badge
                                    variant="default"
                                    className="text-[10px] h-5 px-1.5 bg-blue-600 hover:bg-blue-700"
                                  >
                                    <Globe className="h-3 w-3 mr-0.5" />
                                    Published
                                  </Badge>
                                )}
                              </div>
                              <p className="font-medium text-sm truncate leading-tight">
                                {commit.message}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <p className="text-[10px] text-muted-foreground">
                                  {formatDate(commit.date)} • {commit.author}
                                </p>
                              </div>
                            </div>
                            {workingCommitHash !== commit.hash && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 h-8 w-8 p-0"
                                title={isLoadingThisCommit ? "Loading version" : "Load this version"}
                                disabled={gitOperationInFlight}
                                onClick={() => {
                                  handleLoadCommit(commit.hash);
                                }}
                              >
                                {isLoadingThisCommit ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                ) : (
                                  <RotateCcw className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                                )}
                              </Button>
                            )}
                          </div>
                        </InteractiveSurface>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </SheetContent>

      <AlertDialog open={showLoadWarning} onOpenChange={setShowLoadWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Changes Pending</AlertDialogTitle>
            <AlertDialogDescription>
              You have changes that haven't been snapshotted. Loading a
              different version will discard these changes. Are you sure you
              want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={gitOperationInFlight}
              onClick={() => {
                setShowLoadWarning(false);
                setPendingLoadHash(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={gitOperationInFlight || !pendingLoadHash}
              onClick={() => {
                if (pendingLoadHash && !gitOperationInFlight) {
                  onLoadVersion(pendingLoadHash);
                  setShowLoadWarning(false);
                  setPendingLoadHash(null);
                }
              }}
            >
              {isLoadingVersion ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                "Discard & Load"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new latest snapshot based on what you're currently viewing. You
              can still switch back to other snapshots anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={gitOperationInFlight}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-700 text-white hover:bg-amber-800"
              disabled={gitOperationInFlight}
              onClick={handleRestoreSnapshot}
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                "Restore Snapshot"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Discard all unsaved changes in this version. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={gitOperationInFlight}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={gitOperationInFlight}
              onClick={() => {
                discardMutation.mutate({ slug: projectSlug, version });
                setShowDiscardConfirm(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showGitHubSync ? (
        <AlertDialog
          open={showForceSyncConfirm}
          onOpenChange={setShowForceSyncConfirm}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Force sync from GitHub?</AlertDialogTitle>
              <AlertDialogDescription>
                This will overwrite your local workspace with GitHub’s <code>main</code>{" "}
                branch and remove files deleted on GitHub. Vivd will create a local
                backup tag before overwriting.
                {gitHubSyncStatus?.hasUncommittedChanges
                  ? " You currently have local changes; Vivd will include them in the backup."
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={gitOperationInFlight}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={gitOperationInFlight}
                onClick={() => {
                  gitHubForceSyncMutation.mutate({ slug: projectSlug, version });
                }}
              >
                {gitHubForceSyncMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Force syncing...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Force sync
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Sheet>
  );
}
