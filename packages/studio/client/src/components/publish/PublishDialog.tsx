import { type ReactNode, useEffect, useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Callout,
  CalloutDescription,
  CalloutTitle,
  Input,
  Label,
  Panel,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@vivd/ui";

import {
  Loader2,
  Rocket,
  Tag,
  Info,
  AlertTriangle,
  Save,
  CheckCircle2,
  ExternalLink,
  Globe,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { isLikelyTrpcTimeoutError } from "@/lib/trpcTimeouts";
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

function formatTimeLabel(iso: string | null | undefined): string {
  if (!iso) return "Not available yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not available yet";
  return `${date.toLocaleString()} (${formatDistanceToNow(date, { addSuffix: true })})`;
}

function looksLikeCompleteDomain(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "localhost") return true;
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local"))
    return true;

  const firstDot = normalized.indexOf(".");
  return firstDot > 0 && firstDot < normalized.length - 1;
}

const publishWarningPrimaryActionClassName = "w-full sm:w-auto";
const publishWarningSecondaryActionClassName = "w-full sm:w-auto";

function PublishWarningNotice({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Callout tone="warn" icon={<AlertTriangle />}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CalloutTitle>{title}</CalloutTitle>
          <CalloutDescription className="mt-1">{children}</CalloutDescription>
        </div>
        {actions ? (
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:min-w-fit">
            {actions}
          </div>
        ) : null}
      </div>
    </Callout>
  );
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
  const [domain, setDomain] = useState("");
  const [debouncedDomain, setDebouncedDomain] = useState("");
  const [confirmUnpublishOpen, setConfirmUnpublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Check for unsaved changes
  const { data: hasChangesData, isLoading: isCheckingChanges } =
    trpc.project.gitHasChanges.useQuery(
      { slug: projectSlug, version },
      { enabled: open && !!projectSlug },
    );

  const hasUnsavedChanges = hasChangesData?.hasChanges ?? false;

  // Get publish status (last tag)
  const { data: publishStatus } = trpc.project.publishStatus.useQuery(
    { slug: projectSlug },
    { enabled: open && !!projectSlug },
  );
  const publishedVersion =
    publishStatus && "projectVersion" in publishStatus
      ? publishStatus.projectVersion
      : null;
  const connectedMode = publishStatus?.mode === "connected";

  const publishStateQuery = trpc.project.publishState.useQuery(
    { slug: projectSlug, version },
    {
      enabled: open && !!projectSlug && connectedMode,
      refetchInterval: open && connectedMode ? 5_000 : false,
    },
  );
  const publishChecklistQuery = trpc.project.publishChecklist.useQuery(
    { slug: projectSlug, version },
    {
      enabled: open && !!projectSlug && connectedMode,
      refetchInterval: open && connectedMode ? 10_000 : false,
    },
  );

  useEffect(() => {
    if (!open || !connectedMode) return;
    setDomain(publishStatus?.domain ?? "");
  }, [open, connectedMode, publishStatus?.domain]);

  useEffect(() => {
    if (!open || !connectedMode) return;
    void Promise.all([
      publishStateQuery.refetch(),
      publishChecklistQuery.refetch(),
    ]);
  }, [open, connectedMode, projectSlug, version]);

  useEffect(() => {
    if (!open) {
      setPublishError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !connectedMode) {
      setDebouncedDomain("");
      return;
    }

    const handle = window.setTimeout(() => {
      setDebouncedDomain(domain.trim());
    }, 300);

    return () => window.clearTimeout(handle);
  }, [domain, open, connectedMode]);

  const normalizedDomain = domain.trim();
  const normalizedDebouncedDomain = debouncedDomain.trim();
  const hasDomainInput = normalizedDomain.length > 0;
  const domainInputComplete = looksLikeCompleteDomain(normalizedDomain);
  const shouldValidateDomain =
    open &&
    !!projectSlug &&
    connectedMode &&
    normalizedDebouncedDomain.length > 0 &&
    looksLikeCompleteDomain(normalizedDebouncedDomain);
  const checkDomainQuery = trpc.project.checkDomain.useQuery(
    { domain: normalizedDebouncedDomain, slug: projectSlug },
    {
      enabled: shouldValidateDomain,
    },
  );

  const domainValidationPending = Boolean(
    connectedMode &&
    hasDomainInput &&
    domainInputComplete &&
    (normalizedDomain !== normalizedDebouncedDomain ||
      (shouldValidateDomain && checkDomainQuery.isFetching)),
  );
  const domainError =
    connectedMode &&
    hasDomainInput &&
    domainInputComplete &&
    normalizedDomain === normalizedDebouncedDomain &&
    !domainValidationPending
      ? checkDomainQuery.data?.error
      : undefined;
  const domainOk = Boolean(
    connectedMode &&
    hasDomainInput &&
    domainInputComplete &&
    !domainValidationPending &&
    (checkDomainQuery.data?.available ?? false),
  );

  const publishMutation = trpc.project.publish.useMutation({
    onSuccess: () => {
      setPublishError(null);
      toast.success("Published changes");
      void Promise.all([
        utils.project.publishStatus.invalidate({ slug: projectSlug }),
        utils.project.publishState.invalidate({ slug: projectSlug, version }),
        utils.project.publishChecklist.invalidate({
          slug: projectSlug,
          version,
        }),
      ]);
      onPublished?.();
      onOpenChange(false);
    },
    onError: (error) => {
      if (isLikelyTrpcTimeoutError(error)) {
        const timeoutMessage =
          "Publish request timed out in the browser. It may still complete. Checking status...";
        setPublishError(timeoutMessage);
        toast.error(timeoutMessage);
        void Promise.all([
          utils.project.publishStatus.invalidate({ slug: projectSlug }),
          utils.project.publishState.invalidate({ slug: projectSlug, version }),
          utils.project.publishChecklist.invalidate({
            slug: projectSlug,
            version,
          }),
        ]);
        return;
      }

      const message = error.message || "Failed to publish";
      setPublishError(message);
      toast.error(error.message || "Failed to publish");
      void utils.project.publishState.invalidate({
        slug: projectSlug,
        version,
      });
    },
  });

  const unpublishMutation = trpc.project.unpublish.useMutation({
    onSuccess: () => {
      toast.success("Site unpublished");
      setConfirmUnpublishOpen(false);
      void utils.project.publishStatus.invalidate({ slug: projectSlug });
      onPublished?.();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to unpublish");
    },
  });

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
    [publishStatus?.lastTag],
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
        toast.info(
          connectedMode
            ? "No content changes. Preparing artifacts for publishing..."
            : "No changes to save",
        );
      } else {
        toast.success("Changes saved successfully");
      }
      utils.project.gitHasChanges.invalidate({ slug: projectSlug, version });
      utils.project.gitHistory.invalidate({ slug: projectSlug, version });
      utils.project.gitWorkingCommit.invalidate({ slug: projectSlug, version });
    },
    onError: (error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  const loadLatestMutation = trpc.project.gitLoadLatest.useMutation();

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
        },
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

  if (connectedMode) {
    const publishState = publishStateQuery.data;
    const publishChecklist = publishChecklistQuery.data;
    const studioStateUnknownWarning = Boolean(
      publishState?.studioRunning &&
      publishState?.studioStateAvailable === false,
    );
    const olderSnapshotInStudio = Boolean(
      publishState?.studioRunning &&
      publishState?.studioStateAvailable &&
      publishState?.studioWorkingCommitHash &&
      publishState?.studioHeadCommitHash &&
      publishState.studioWorkingCommitHash !==
        publishState.studioHeadCommitHash,
    );
    const unsavedChangesInStudio = Boolean(
      publishState?.studioRunning &&
      publishState?.studioStateAvailable &&
      publishState?.studioHasUnsavedChanges,
    );

    const publishTargetCommitHash =
      publishState?.studioRunning &&
      publishState?.studioStateAvailable &&
      publishState?.studioHeadCommitHash
        ? publishState.studioHeadCommitHash
        : (publishState?.publishableCommitHash ?? null);
    const publishableCommitMatchesTarget = Boolean(
      publishTargetCommitHash &&
      publishState?.publishableCommitHash &&
      publishState.publishableCommitHash === publishTargetCommitHash,
    );
    const preparingLatestSnapshotWarning = Boolean(
      publishState?.studioRunning &&
      publishState?.studioStateAvailable &&
      publishState?.studioHeadCommitHash &&
      publishState?.publishableCommitHash &&
      publishState.publishableCommitHash !== publishState.studioHeadCommitHash,
    );
    const missingPublishableSnapshot = Boolean(
      publishState?.readiness === "ready" &&
      !publishState?.publishableCommitHash &&
      !studioStateUnknownWarning &&
      !olderSnapshotInStudio &&
      !unsavedChangesInStudio,
    );
    const canRequestPreparePublishArtifacts = Boolean(
      !olderSnapshotInStudio &&
      !unsavedChangesInStudio &&
      !studioStateUnknownWarning &&
      (missingPublishableSnapshot ||
        preparingLatestSnapshotWarning ||
        publishState?.readiness === "artifact_not_ready" ||
        publishState?.readiness === "not_found"),
    );

    const canPublishNow =
      publishState?.storageEnabled &&
      publishState?.readiness === "ready" &&
      domainOk &&
      !studioStateUnknownWarning &&
      !publishState?.studioHasUnsavedChanges &&
      !olderSnapshotInStudio &&
      publishableCommitMatchesTarget;

    const publishDisabled =
      publishMutation.isPending ||
      saveMutation.isPending ||
      loadLatestMutation.isPending ||
      !canPublishNow;

    const publishDisabledReason: string | null = (() => {
      if (publishMutation.isPending)
        return "Publishing is already in progress.";
      if (saveMutation.isPending) return "Saving your changes...";
      if (loadLatestMutation.isPending) return "Switching snapshots...";

      if (!publishState) return "Loading publish status...";
      if (!publishState.storageEnabled)
        return "Publishing isn't available right now.";

      if (publishState.readiness !== "ready") {
        if (publishState.readiness === "build_in_progress") {
          return "We're getting your site ready to publish. This can take a little while, and we'll update automatically.";
        }
        if (publishState.readiness === "artifact_not_ready") {
          return "We're preparing your site for publishing. This can take a little while, and we'll update automatically.";
        }
        return "We're preparing your site for publishing. This can take a little while, and we'll update automatically.";
      }

      if (olderSnapshotInStudio) {
        return "Restore your snapshot before publishing.";
      }
      if (studioStateUnknownWarning) {
        return "Studio is still loading. This can take a little while.";
      }
      if (unsavedChangesInStudio) {
        return "Save your changes before publishing.";
      }
      if (missingPublishableSnapshot) {
        return "Prepare your current snapshot once to enable publishing.";
      }
      if (preparingLatestSnapshotWarning) {
        return "Prepare your latest saved snapshot once to enable publishing.";
      }
      if (!publishableCommitMatchesTarget) {
        return "We're preparing your latest changes for publishing. This can take a little while, and we'll update automatically.";
      }

      if (!hasDomainInput) return "Enter a domain.";
      if (!domainInputComplete)
        return "Enter a complete domain (for example, example.com).";
      if (domainValidationPending) return "Checking domain...";
      if (!domainOk) return domainError || "Enter a valid domain.";

      return null;
    })();

    const handlePreparePublishArtifacts = async () => {
      setPublishError(null);
      try {
        await saveMutation.mutateAsync({
          slug: projectSlug,
          version,
          message: "Prepare publish artifacts",
        });
        await publishStateQuery.refetch();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to prepare publish artifacts";
        toast.error(message);
      }
    };

    const handleConnectedPublish = async () => {
      setPublishError(null);

      if (!domainOk) {
        if (!hasDomainInput) {
          toast.error("Enter a domain");
          return;
        }
        if (!domainInputComplete) {
          toast.error("Enter a complete domain");
          return;
        }
        if (domainValidationPending) {
          toast.error("Checking domain...");
          return;
        }
        toast.error(domainError || "Enter a valid domain");
        return;
      }

      try {
        const latestStateResult = await publishStateQuery.refetch();
        const latestState = latestStateResult.data;
        if (!latestState) {
          toast.error(
            "Publishing status is still loading. Please wait a little while.",
          );
          return;
        }

        if (!latestState.storageEnabled) {
          toast.error("Publishing is not available for this project yet.");
          return;
        }

        const latestStudioStateUnknownWarning = Boolean(
          latestState?.studioRunning &&
          latestState?.studioStateAvailable === false,
        );
        if (latestStudioStateUnknownWarning) {
          toast.error("Studio is still loading. Please wait a little while.");
          return;
        }

        const latestOlderSnapshotInStudio = Boolean(
          latestState?.studioRunning &&
          latestState?.studioStateAvailable &&
          latestState?.studioWorkingCommitHash &&
          latestState?.studioHeadCommitHash &&
          latestState.studioWorkingCommitHash !==
            latestState.studioHeadCommitHash,
        );
        if (latestOlderSnapshotInStudio) {
          toast.error(
            "You're viewing an older snapshot. Restore it (or go back to latest) before publishing.",
          );
          return;
        }

        const latestUnsavedChangesInStudio = Boolean(
          latestState?.studioRunning &&
          latestState?.studioStateAvailable &&
          latestState?.studioHasUnsavedChanges,
        );
        if (latestUnsavedChangesInStudio) {
          toast.error(
            "You have unsaved changes. Save your changes before publishing.",
          );
          return;
        }

        const targetCommitHash =
          latestState?.studioRunning &&
          latestState?.studioStateAvailable &&
          latestState?.studioHeadCommitHash
            ? latestState.studioHeadCommitHash
            : (latestState?.publishableCommitHash ?? undefined);
        if (!targetCommitHash) {
          toast.error("No publishable version found.");
          return;
        }

        if (
          latestState?.readiness !== "ready" ||
          latestState?.publishableCommitHash !== targetCommitHash
        ) {
          toast.error(
            "Your latest changes are still being prepared for publishing. Please wait a little while.",
          );
          return;
        }

        await publishMutation.mutateAsync({
          slug: projectSlug,
          version,
          domain: normalizedDomain,
          expectedCommitHash: targetCommitHash,
        });
      } catch (err) {
        if (isLikelyTrpcTimeoutError(err)) {
          // publishMutation.onError already handles timeout copy + status refresh.
          return;
        }
        // publishMutation already surfaces errors via its onError handler.
        const message =
          err instanceof Error ? err.message : "Failed to publish";
        setPublishError(message);
      }
    };

    return (
      <>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-[560px] max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Rocket className="h-5 w-5" />
                Publish Site
              </DialogTitle>
              <DialogDescription>
                Make {projectSlug} live at your domain.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 overflow-y-auto py-1">
              <Panel tone="sunken" className="rounded-md p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Publishing content
                  </span>
                  <span className="text-foreground">
                    {publishState?.sourceKind === "preview"
                      ? "Latest preview build"
                      : "Latest saved files"}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    Version: <span className="text-foreground">v{version}</span>
                  </div>
                  <div>
                    Prepared:{" "}
                    <span className="text-foreground">
                      {formatTimeLabel(publishState?.builtAt)}
                    </span>
                  </div>
                </div>
              </Panel>

              {publishState?.readiness === "build_in_progress" ? (
                <PublishWarningNotice title="Site build in progress">
                  You can publish once the latest build finishes.
                </PublishWarningNotice>
              ) : null}

              {publishState?.readiness === "artifact_not_ready" ? (
                <Callout tone="danger">
                  <div>
                    We're still preparing your site for publishing. This can
                    take a little while.
                  </div>
                  {import.meta.env.DEV && publishState.error ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {publishState.error}
                    </div>
                  ) : null}
                </Callout>
              ) : null}

              {publishError ? (
                <Callout tone="danger">{publishError}</Callout>
              ) : null}

              {olderSnapshotInStudio ? (
                <PublishWarningNotice
                  title="You're viewing an older snapshot"
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className={publishWarningPrimaryActionClassName}
                        onClick={() => {
                          setPublishError(null);
                          saveMutation
                            .mutateAsync({
                              slug: projectSlug,
                              version,
                              message: "Restore snapshot",
                            })
                            .then(() => {
                              void Promise.all([
                                publishStateQuery.refetch(),
                                utils.project.gitHistory.invalidate({
                                  slug: projectSlug,
                                  version,
                                }),
                              ]);
                            })
                            .catch((err) => {
                              const message =
                                err instanceof Error
                                  ? err.message
                                  : "Failed to restore snapshot";
                              toast.error(message);
                            });
                        }}
                        disabled={
                          publishMutation.isPending ||
                          saveMutation.isPending ||
                          loadLatestMutation.isPending
                        }
                      >
                        {saveMutation.isPending ? (
                          <>
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            Restoring...
                          </>
                        ) : (
                          "Restore snapshot"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={publishWarningSecondaryActionClassName}
                        onClick={() => {
                          setPublishError(null);
                          loadLatestMutation
                            .mutateAsync({
                              slug: projectSlug,
                              version,
                            })
                            .then(() => {
                              toast.success("Switched back to latest snapshot");
                              void Promise.all([
                                publishStateQuery.refetch(),
                                utils.project.gitHasChanges.invalidate({
                                  slug: projectSlug,
                                  version,
                                }),
                                utils.project.gitHistory.invalidate({
                                  slug: projectSlug,
                                  version,
                                }),
                                utils.project.gitWorkingCommit.invalidate({
                                  slug: projectSlug,
                                  version,
                                }),
                              ]);
                            })
                            .catch((err) => {
                              const message =
                                err instanceof Error
                                  ? err.message
                                  : "Failed to switch snapshots";
                              toast.error(message);
                            });
                        }}
                        disabled={
                          publishMutation.isPending ||
                          saveMutation.isPending ||
                          loadLatestMutation.isPending
                        }
                      >
                        {loadLatestMutation.isPending ? (
                          <>
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          "Back to latest"
                        )}
                      </Button>
                    </>
                  }
                >
                  Restore it, or go back to the latest snapshot, before
                  publishing so the live site matches what you're seeing.
                </PublishWarningNotice>
              ) : null}

              {studioStateUnknownWarning ? (
                <PublishWarningNotice title="Studio is still loading">
                  Studio is active, but its current state is still syncing. This
                  updates automatically.
                </PublishWarningNotice>
              ) : null}

              {unsavedChangesInStudio ? (
                <PublishWarningNotice
                  title="Unsaved changes in Studio"
                  actions={
                    <Button
                      size="sm"
                      variant="outline"
                      className={publishWarningPrimaryActionClassName}
                      onClick={() => {
                        setPublishError(null);
                        saveMutation
                          .mutateAsync({
                            slug: projectSlug,
                            version,
                            message: "Save changes",
                          })
                          .then(() => {
                            void publishStateQuery.refetch();
                          })
                          .catch((err) => {
                            const message =
                              err instanceof Error
                                ? err.message
                                : "Failed to save changes";
                            toast.error(message);
                          });
                      }}
                      disabled={
                        publishMutation.isPending ||
                        saveMutation.isPending ||
                        loadLatestMutation.isPending
                      }
                    >
                      {saveMutation.isPending ? (
                        <>
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-1.5 h-4 w-4" />
                          Save changes
                        </>
                      )}
                    </Button>
                  }
                >
                  Save your changes before publishing to include your latest
                  edits.
                </PublishWarningNotice>
              ) : null}

              {canRequestPreparePublishArtifacts ? (
                <PublishWarningNotice
                  title={
                    preparingLatestSnapshotWarning
                      ? "Prepare your latest saved snapshot"
                      : "Prepare this snapshot once"
                  }
                  actions={
                    <Button
                      size="sm"
                      variant="outline"
                      className={publishWarningPrimaryActionClassName}
                      onClick={() => void handlePreparePublishArtifacts()}
                      disabled={
                        publishMutation.isPending ||
                        saveMutation.isPending ||
                        loadLatestMutation.isPending
                      }
                    >
                      {saveMutation.isPending ? (
                        <>
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          Preparing...
                        </>
                      ) : (
                        "Prepare for publish"
                      )}
                    </Button>
                  }
                >
                  {preparingLatestSnapshotWarning
                    ? "The latest saved snapshot is newer than the currently prepared publish artifact. Run prepare once to rebuild it without creating a new commit."
                    : "Publishing needs one artifact-preparation run for the current snapshot. This does not create a new commit."}
                </PublishWarningNotice>
              ) : null}

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

              {publishChecklist?.checklist ? (
                <div className="rounded-md border p-3 text-xs text-muted-foreground">
                  Checklist: {publishChecklist.checklist.summary.passed}/
                  {publishChecklist.checklist.items.length} passed
                  {publishChecklist.stale ? " (stale)" : " (fresh)"}
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="publish-domain">Domain</Label>
                <Input
                  id="publish-domain"
                  placeholder="example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  autoComplete="off"
                  disabled={
                    publishMutation.isPending ||
                    saveMutation.isPending ||
                    loadLatestMutation.isPending
                  }
                />
                {domainError ? (
                  <p className="text-xs text-destructive">{domainError}</p>
                ) : null}
              </div>

              {publishStatus?.isPublished ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      Published at{" "}
                      <span className="font-medium">
                        {publishStatus.domain}
                      </span>
                      {publishStatus.publishedAt
                        ? ` · ${formatTimeLabel(publishStatus.publishedAt)}`
                        : ""}
                    </div>
                    {publishStatus.url ? (
                      <a
                        className="inline-flex items-center gap-1 text-emerald-900 hover:underline dark:text-emerald-200"
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
              <div>
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
              <div className="flex flex-col gap-2 sm:items-end">
                {publishDisabled && publishDisabledReason ? (
                  <div className="text-xs text-muted-foreground sm:max-w-sm sm:text-right">
                    {publishDisabledReason}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {publishDisabled &&
                  (olderSnapshotInStudio ||
                    unsavedChangesInStudio ||
                    studioStateUnknownWarning) ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex" tabIndex={0}>
                          <Button
                            onClick={() => void handleConnectedPublish()}
                            disabled
                          >
                            <Globe className="h-4 w-4 mr-2" />
                            Publish site
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-sm">
                          {olderSnapshotInStudio
                            ? "You're viewing an older snapshot. Restore it (or go back to latest) before publishing."
                            : studioStateUnknownWarning
                              ? "Studio is still loading. Please wait a little while."
                              : "You have unsaved changes. Save changes before publishing to include your latest edits."}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      onClick={() => void handleConnectedPublish()}
                      disabled={publishDisabled}
                    >
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
                  )}
                </div>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={confirmUnpublishOpen}
          onOpenChange={setConfirmUnpublishOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unpublish site?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove publish routing for{" "}
                <span className="font-medium">
                  {publishStatus?.domain || projectSlug}
                </span>
                {publishedVersion ? ` (v${publishedVersion})` : ""}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => unpublishMutation.mutate({ slug: projectSlug })}
              >
                Unpublish
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

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
                <Callout tone="warn" icon={<AlertTriangle />}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-amber-700 dark:text-amber-400">
                      You have unsaved changes
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveChanges}
                    disabled={saveMutation.isPending}
                    className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Save Now
                  </Button>
                </Callout>
              )}

              {/* No unsaved changes - show success state */}
              {!isCheckingChanges && !hasUnsavedChanges && (
                <Callout tone="success" icon={<CheckCircle2 />}>
                  <span className="text-sm text-green-700 dark:text-green-300">
                    All changes saved
                  </span>
                </Callout>
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
                <Label htmlFor="version-message">
                  Release Notes (optional)
                </Label>
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
                    <strong className="text-destructive">
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
