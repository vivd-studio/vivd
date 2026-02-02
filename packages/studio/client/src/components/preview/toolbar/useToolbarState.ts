import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { POLLING_BACKGROUND } from "@/app/config/polling";
import { toast } from "sonner";
import { usePreview } from "../PreviewContext";

/**
 * Shared hook for toolbar state and mutations
 */
export function useToolbarState() {
  const utils = trpc.useUtils();
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  const {
    projectSlug,
    originalUrl,
    copied,
    selectedVersion,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    editMode,
    hasUnsavedChanges,
    fullUrl,
    versions,
    hasMultipleVersions,
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    toggleEditMode,
    assetsOpen,
    setAssetsOpen,
    chatOpen,
    setChatOpen,
    handleClose,
    embedded,
  } = usePreview();

  // Git changes query
  const { data: changesData } = trpc.project.gitHasChanges.useQuery(
    { slug: projectSlug!, version: selectedVersion },
    { enabled: !!projectSlug, refetchInterval: POLLING_BACKGROUND }
  );
  const hasGitChanges = changesData?.hasChanges || false;

  // Publish status query
  const { data: publishStatus } = trpc.project.publishStatus.useQuery(
    { slug: projectSlug! },
    { enabled: !!projectSlug }
  );
  const isPublished = publishStatus?.isPublished || false;

  // Load version mutation
  const loadVersionMutation = trpc.project.gitLoadVersion.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      handleRefresh();
      utils.project.gitHistory.invalidate({
        slug: projectSlug!,
        version: selectedVersion,
      });
      utils.project.gitHasChanges.invalidate({
        slug: projectSlug!,
        version: selectedVersion,
      });
      utils.project.gitWorkingCommit.invalidate({
        slug: projectSlug!,
        version: selectedVersion,
      });
    },
    onError: (error) => {
      toast.error(`Failed to load version: ${error.message}`);
    },
  });

  const handleLoadVersion = (commitHash: string) => {
    if (!projectSlug) return;
    loadVersionMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
      commitHash,
    });
  };

  return {
    // Dialog states
    historyPanelOpen,
    setHistoryPanelOpen,
    publishDialogOpen,
    setPublishDialogOpen,

    // From preview context
    projectSlug,
    originalUrl,
    copied,
    selectedVersion,
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    editMode,
    hasUnsavedChanges,
    fullUrl,
    versions,
    hasMultipleVersions,
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    toggleEditMode,
    assetsOpen,
    setAssetsOpen,
    chatOpen,
    setChatOpen,
    handleClose,
    embedded,

    // Query data
    hasGitChanges,
    isPublished,
    publishStatus,

    // Mutations
    handleLoadVersion,

    // Utils for cache invalidation
    utils,
  };
}

export type ToolbarState = ReturnType<typeof useToolbarState>;
