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
  History,
  RotateCcw,
  GitCommit,
  Trash2,
  Save,
  Loader2,
  Globe,
  Wand2,
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
  onRefresh?: () => void;
}

export function VersionHistoryPanel({
  open,
  onOpenChange,
  projectSlug,
  version,
  onLoadVersion,
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

  const [showLoadWarning, setShowLoadWarning] = useState(false);
  const [pendingLoadHash, setPendingLoadHash] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

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
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Failed to discard: ${error.message}`);
    },
  });

  const commits = historyData?.commits || [];
  const hasUncommittedChanges = changesData?.hasChanges || false;
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
      ]);
      onRefresh?.();
    },
    onError: (error) => {
      toast.error(`Failed to restore snapshot: ${error.message}`);
    },
  });

  const handleDiscard = () => {
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
    if (hasUncommittedChanges) {
      setPendingLoadHash(hash);
      setShowLoadWarning(true);
      return;
    }
    onLoadVersion(hash);
  };

  const handleRestoreSnapshot = () => {
    const snapshotName = workingCommit?.message?.trim() || "Snapshot";
    restoreMutation.mutate({
      slug: projectSlug,
      version,
      message: `Restored: ${snapshotName}`,
    });
  };

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
                  disabled={restoreMutation.isPending || isSaving}
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
                    disabled={restoreMutation.isPending || isSaving}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Back to Latest
                  </Button>
                ) : null}
              </div>
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
                />
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !commitMessage.trim()}
                  size="icon"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <div className="flex justify-between items-center pt-1">
                <span className="text-xs text-muted-foreground">
                  Create a version point you can return to
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscard}
                  disabled={discardMutation.isPending}
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

                        <div className="p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
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
                                title="Load this version"
                                onClick={() => {
                                  handleLoadCommit(commit.hash);
                                }}
                              >
                                <RotateCcw className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                              </Button>
                            )}
                          </div>
                        </div>
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
              onClick={() => {
                setShowLoadWarning(false);
                setPendingLoadHash(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingLoadHash) {
                  onLoadVersion(pendingLoadHash);
                  setShowLoadWarning(false);
                  setPendingLoadHash(null);
                }
              }}
            >
              Discard & Load
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
            <AlertDialogCancel disabled={restoreMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-700 text-white hover:bg-amber-800"
              disabled={restoreMutation.isPending}
              onClick={handleRestoreSnapshot}
            >
              Restore Snapshot
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
            <AlertDialogCancel disabled={discardMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={discardMutation.isPending}
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
    </Sheet>
  );
}
