import { useEffect, useState, useMemo } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Loader2,
  Rocket,
  Tag,
  Info,
  AlertTriangle,
  Save,
  CheckCircle2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PrePublishChecklist } from "./PrePublishChecklist";
import { usePrePublishChecklist } from "./usePrePublishChecklist";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  version: number;
  onPublished?: () => void;
}

/**
 * Parse a version tag and return the next suggested version.
 * Supports semver-like versions (v1.0.0, 1.0.0) and simple versions (v1, v2).
 */
function suggestNextVersion(lastTag: string | null): string {
  if (!lastTag) {
    return "v1.0.0";
  }

  // Remove 'v' prefix if present
  const hasPrefix = lastTag.startsWith("v");
  const version = hasPrefix ? lastTag.slice(1) : lastTag;

  // Try to parse as semver (x.y.z)
  const semverMatch = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (semverMatch) {
    const [, major, minor, patch] = semverMatch;
    // Increment patch version
    const nextPatch = parseInt(patch, 10) + 1;
    return `${hasPrefix ? "v" : ""}${major}.${minor}.${nextPatch}`;
  }

  // Try simple version (just a number)
  const simpleMatch = version.match(/^(\d+)$/);
  if (simpleMatch) {
    const next = parseInt(simpleMatch[1], 10) + 1;
    return `${hasPrefix ? "v" : ""}${next}`;
  }

  // Fallback: append a number or increment if already has one
  const trailingNumberMatch = lastTag.match(/^(.+?)(\d+)$/);
  if (trailingNumberMatch) {
    const [, prefix, num] = trailingNumberMatch;
    return `${prefix}${parseInt(num, 10) + 1}`;
  }

  // Last resort: just add -2 to the tag
  return `${lastTag}-2`;
}

/**
 * Standalone studio publish dialog.
 *
 * In the single-instance studio, "publishing" creates a versioned snapshot
 * by saving any unsaved changes and creating a git tag.
 */
export function PublishDialog({
  open,
  onOpenChange,
  projectSlug,
  version,
  onPublished,
}: PublishDialogProps) {
  const utils = trpc.useUtils();
  const [versionName, setVersionName] = useState("");
  const [message, setMessage] = useState("");
  const [showPublishWarning, setShowPublishWarning] = useState(false);

  // Check for unsaved changes
  const { data: hasChangesData, isLoading: isCheckingChanges } =
    trpc.project.gitHasChanges.useQuery(
      { slug: projectSlug, version },
      { enabled: open && !!projectSlug }
    );

  const hasUnsavedChanges = hasChangesData?.hasChanges ?? false;

  // Get publish status (last tag)
  const { data: publishStatus } = trpc.project.publishStatus.useQuery(
    { slug: projectSlug },
    { enabled: open && !!projectSlug }
  );

  // Pre-publish checklist
  const {
    checklist,
    hasChangesSinceCheck,
    isLoadingChecklist,
    runChecklist,
    isRunningChecklist,
    fixChecklistItem,
    fixingItemId,
  } = usePrePublishChecklist({ dialogOpen: open, projectSlug, version });

  // Suggest next version when dialog opens or lastTag changes
  const suggestedVersion = useMemo(
    () => suggestNextVersion(publishStatus?.lastTag ?? null),
    [publishStatus?.lastTag]
  );

  useEffect(() => {
    if (open) {
      setVersionName(suggestedVersion);
      setMessage("");
    }
  }, [open, suggestedVersion]);

  // Save changes mutation (commit + push)
  const saveMutation = trpc.project.gitSave.useMutation({
    onSuccess: (data) => {
      if (data.noChanges) {
        toast.info("No changes to save");
      } else {
        toast.success("Changes saved successfully");
      }
      utils.project.gitHasChanges.invalidate({ slug: projectSlug, version });
      utils.project.gitHistory.invalidate({ slug: projectSlug, version });
    },
    onError: (error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  // Create tag mutation
  const createTagMutation = trpc.project.createTag.useMutation({
    onSuccess: (data) => {
      toast.success(`Published version ${data.tag}`);
      utils.project.publishStatus.invalidate({ slug: projectSlug });
      onPublished?.();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to publish: ${error.message}`);
    },
  });

  const handleSaveChanges = () => {
    saveMutation.mutate({
      slug: projectSlug,
      version,
      message: "Auto-save before publish",
    });
  };

  const handlePublish = () => {
    if (!versionName.trim()) {
      toast.error("Please enter a version name");
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
    // If there are unsaved changes, save them first
    if (hasUnsavedChanges && !saveMutation.isPending) {
      saveMutation.mutate(
        {
          slug: projectSlug,
          version,
          message: message.trim() || `Publish ${versionName.trim()}`,
        },
        {
          onSuccess: () => {
            // Then create the tag
            createTagMutation.mutate({
              slug: projectSlug,
              tagName: versionName.trim(),
              message: message.trim() || undefined,
            });
          },
        }
      );
    } else {
      // No unsaved changes, just create the tag
      createTagMutation.mutate({
        slug: projectSlug,
        tagName: versionName.trim(),
        message: message.trim() || undefined,
      });
    }
    setShowPublishWarning(false);
  };

  // Separate "publishing" state from "busy" state for button display
  const isPublishing = createTagMutation.isPending || saveMutation.isPending;
  const isBusy = isPublishing || isRunningChecklist || fixingItemId !== null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              Publish Version
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-sm">
                    Publishing creates a versioned snapshot of your website.
                    This allows you to track changes over time and roll back if
                    needed.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Technical: Creates a git tag that marks this exact state.
                  </p>
                </TooltipContent>
              </Tooltip>
            </DialogTitle>
            <DialogDescription>
              Create a new published version of your website.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-4 py-4">
              {/* Unsaved Changes Warning */}
              {!isCheckingChanges && hasUnsavedChanges && (
                <div className="flex items-center justify-between p-3 rounded-lg border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm text-amber-700 dark:text-amber-400">
                      You have unsaved changes
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveChanges}
                    disabled={saveMutation.isPending}
                    className="border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Save Now
                  </Button>
                </div>
              )}

              {/* No unsaved changes - show success state */}
              {!isCheckingChanges && !hasUnsavedChanges && (
                <div className="flex items-center gap-2 p-3 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-400">
                    All changes saved
                  </span>
                </div>
              )}

              {/* Pre-publish Checklist */}
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

              {/* Last Published Version */}
              {publishStatus?.lastTag && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Tag className="h-4 w-4" />
                  Last version:{" "}
                  <span className="font-mono">{publishStatus.lastTag}</span>
                </div>
              )}

              {/* Version Name Input */}
              <div className="grid gap-2">
                <Label htmlFor="version-name">Version</Label>
                <Input
                  id="version-name"
                  placeholder="v1.0.0"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  A unique name for this version (e.g., v1.0.0, v2.0.0)
                </p>
              </div>

              {/* Message Input */}
              <div className="grid gap-2">
                <Label htmlFor="version-message">Release Notes (optional)</Label>
                <Input
                  id="version-message"
                  placeholder="What's new in this version..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePublish}
              disabled={isBusy || !versionName.trim()}
            >
              {isPublishing ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {saveMutation.isPending ? "Saving..." : "Publishing..."}
                </span>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-2" />
                  Publish
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
