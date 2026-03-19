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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InteractiveSurface } from "@/components/ui/interactive-surface";
import { Settings2, Trash2, Loader2, Globe, AlertTriangle } from "lucide-react";
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

interface VersionInfo {
  version: number;
  createdAt: string;
  status: string;
  errorMessage?: string;
}

interface VersionManagementPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  versions: VersionInfo[];
  publishedVersion?: number | null;
  onVersionDeleted?: () => void;
}

export function VersionManagementPanel({
  open,
  onOpenChange,
  projectSlug,
  versions,
  publishedVersion,
  onVersionDeleted,
}: VersionManagementPanelProps) {
  const utils = trpc.useUtils();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<number | null>(null);
  const [confirmationText, setConfirmationText] = useState("");

  const deleteVersionMutation = trpc.project.deleteVersion.useMutation({
    onSuccess: (data) => {
      toast.success("Version Deleted", {
        description: data.message,
      });
      setShowDeleteConfirm(false);
      setVersionToDelete(null);
      setConfirmationText("");
      utils.project.list.invalidate();
      utils.project.status.invalidate({ slug: projectSlug });
      onVersionDeleted?.();
    },
    onError: (error) => {
      toast.error("Delete Failed", {
        description: error.message,
      });
    },
  });

  const handleDeleteClick = (version: number) => {
    setVersionToDelete(version);
    setConfirmationText("");
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (versionToDelete === null) return;
    deleteVersionMutation.mutate({
      slug: projectSlug,
      version: versionToDelete,
      confirmationText,
    });
  };

  const formatDate = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="success">Completed</Badge>
        );
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const canDeleteVersion = (
    version: VersionInfo,
  ): { canDelete: boolean; reason?: string } => {
    if (version.version === publishedVersion) {
      return {
        canDelete: false,
        reason: "This version is currently published",
      };
    }
    if (versions.length <= 1) {
      return { canDelete: false, reason: "Cannot delete the only version" };
    }
    return { canDelete: true };
  };

  const expectedConfirmation =
    versionToDelete !== null ? `v${versionToDelete}` : "";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[380px] sm:w-[420px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Manage Versions
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 flex flex-col h-[calc(100vh-120px)]">
            <p className="text-sm text-muted-foreground mb-4">
              Delete old versions to free up storage. Published versions and the
              last remaining version cannot be deleted.
            </p>

            <ScrollArea className="flex-1 -mr-4 pr-4">
              <div className="space-y-3">
                {versions
                  .slice()
                  .sort((a, b) => b.version - a.version)
                  .map((version) => {
                    const { canDelete, reason } = canDeleteVersion(version);
                    const isPublished = version.version === publishedVersion;

                    return (
                      <InteractiveSurface
                        variant="choice"
                        key={version.version}
                        className="rounded-lg p-4 hover:bg-accent/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="font-semibold text-base">
                                v{version.version}
                              </span>
                              {getStatusBadge(version.status)}
                              {isPublished && (
                                <Badge
                                  variant="default"
                                  className="bg-blue-600 hover:bg-blue-700"
                                >
                                  <Globe className="h-3 w-3 mr-1" />
                                  Published
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Created {formatDate(version.createdAt)}
                            </p>
                            {version.errorMessage && (
                              <p
                                className="text-xs text-destructive mt-1 truncate"
                                title={version.errorMessage}
                              >
                                {version.errorMessage}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            disabled={!canDelete}
                            title={reason || "Delete this version"}
                            onClick={() => handleDeleteClick(version.version)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </InteractiveSurface>
                    );
                  })}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Version {versionToDelete}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                This will permanently delete version {versionToDelete} of "
                {projectSlug}". All files, history, and data for this version
                will be removed.
              </span>
              <span className="block font-medium text-foreground">
                This action cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-2">
            <Label htmlFor="confirm-delete" className="text-sm font-medium">
              Type{" "}
              <span className="font-mono bg-muted px-1 rounded">
                {expectedConfirmation}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder={expectedConfirmation}
              className="mt-2"
              autoComplete="off"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteVersionMutation.isPending}
              onClick={() => {
                setVersionToDelete(null);
                setConfirmationText("");
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:border dark:border-destructive/40 dark:bg-destructive/12 dark:text-destructive dark:shadow-none dark:hover:bg-destructive/18 dark:hover:border-destructive/55"
              disabled={
                deleteVersionMutation.isPending ||
                confirmationText !== expectedConfirmation
              }
              onClick={handleConfirmDelete}
            >
              {deleteVersionMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Version"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
