import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  History,
  RotateCcw,
  GitCommit,
  AlertCircle,
  Trash2,
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

  const { data: historyData, isLoading: historyLoading } =
    trpc.project.gitHistory.useQuery(
      { slug: projectSlug, version },
      { enabled: open && !!projectSlug }
    );

  const { data: changesData } = trpc.project.gitHasChanges.useQuery(
    { slug: projectSlug, version },
    { enabled: open && !!projectSlug, refetchInterval: 5000 }
  );

  const { data: workingCommitData } = trpc.project.gitWorkingCommit.useQuery(
    { slug: projectSlug, version },
    { enabled: open && !!projectSlug }
  );

  const [showLoadWarning, setShowLoadWarning] = useState(false);
  const [pendingLoadHash, setPendingLoadHash] = useState<string | null>(null);

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

  const handleDiscard = () => {
    if (
      window.confirm(
        "Are you sure you want to discard all unsaved changes? This cannot be undone."
      )
    ) {
      discardMutation.mutate({ slug: projectSlug, version });
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 flex flex-col h-[calc(100vh-120px)]">
          {/* Working indicator */}
          {hasUncommittedChanges && (
            <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-medium text-sm">Unsaved changes</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscard}
                  disabled={discardMutation.isPending}
                  className="text-red-600 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/20 h-7 px-2"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Discard
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                You have unsaved changes. Save or discard them.
              </p>
            </div>
          )}

          {/* Commit list */}
          <ScrollArea className="flex-1 -mr-4 pr-4">
            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : commits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <GitCommit className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No saved versions yet</p>
                <p className="text-xs mt-1">
                  Make changes and save to create your first version
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
                            </div>
                            <p className="font-medium text-sm truncate leading-tight">
                              {commit.message}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <p className="text-[10px] text-muted-foreground">
                                {formatDate(commit.date)} • {commit.author}
                              </p>
                            </div>
                            {/* Optional: Show parent if relevant (for debugging/visual confirmation) */}
                            {/* 
                            <div className="text-[10px] text-muted-foreground/50 mt-1">
                              Parent: {commit.parents[0]?.substring(0, 7) || "None"}
                            </div> 
                            */}
                          </div>
                          {workingCommitHash !== commit.hash && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 h-8 w-8 p-0"
                              title="Load this version"
                              onClick={() => {
                                if (hasUncommittedChanges) {
                                  setPendingLoadHash(commit.hash);
                                  setShowLoadWarning(true);
                                } else {
                                  onLoadVersion(commit.hash);
                                }
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
      </SheetContent>

      <AlertDialog open={showLoadWarning} onOpenChange={setShowLoadWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Loading a different version will discard
              these changes. Are you sure you want to continue?
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
    </Sheet>
  );
}
