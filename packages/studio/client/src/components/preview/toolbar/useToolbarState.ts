import { useState, useCallback, useRef } from "react";
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
  const [loadingVersionHash, setLoadingVersionHash] = useState<string | null>(null);
  const loadVersionLockRef = useRef(false);

  const {
    projectSlug,
    originalUrl,
    copied,
    selectedVersion,
    sessionHistoryOpen,
    setSessionHistoryOpen,
    viewportMode,
    setViewportMode,
    selectedDevice,
    setSelectedDevice,
    editMode,
    hasUnsavedChanges,
    fullUrl,
    currentPreviewPath,
    versions,
    hasMultipleVersions,
    analyticsAvailable,
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    navigatePreviewPath,
    toggleEditMode,
    assetsOpen,
    setAssetsOpen,
    pluginsOpen,
    setPluginsOpen,
    chatOpen,
    chatPanel,
    setChatOpen,
    handleClose,
    embedded,
    publicPreviewEnabled,
    previewMode,
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
    onSettled: () => {
      loadVersionLockRef.current = false;
      setLoadingVersionHash(null);
    },
  });

  const handleLoadVersion = (commitHash: string) => {
    if (!projectSlug || loadVersionMutation.isPending || loadVersionLockRef.current) return;
    loadVersionLockRef.current = true;
    setLoadingVersionHash(commitHash);
    loadVersionMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
      commitHash,
    });
  };

  const [devServerRestartKind, setDevServerRestartKind] = useState<
    "restart" | "clean" | null
  >(null);

  const restartDevServerMutation = trpc.project.restartDevServer.useMutation({
    onSuccess: (data) => {
      if (!data.success) {
        toast.error("Dev server restart failed", {
          description:
            data.error || "Dev server could not be restarted right now",
        });
        return;
      }
      handleRefresh();
    },
    onError: (error) => {
      toast.error("Dev server restart failed", { description: error.message });
    },
    onSettled: () => {
      setDevServerRestartKind(null);
    },
  });

  const handleRestartDevServer = useCallback(
    (options?: { clean?: boolean }) => {
      if (!projectSlug || previewMode !== "devserver") return;
      setDevServerRestartKind(options?.clean ? "clean" : "restart");
      restartDevServerMutation.mutate({
        slug: projectSlug,
        version: selectedVersion,
        clean: options?.clean,
      });
    },
    [projectSlug, previewMode, restartDevServerMutation, selectedVersion],
  );

  // Connected-mode only: toggle public preview URL
  const isConnectedMode = publishStatus?.mode === "connected";

  const setPublicPreviewEnabledMutation =
    trpc.project.setPublicPreviewEnabled.useMutation({
      onSuccess: (data) => {
        toast.success(
          data.publicPreviewEnabled
            ? "Preview URL enabled"
            : "Preview URL disabled",
        );
      },
      onError: (error) => {
        toast.error("Failed to update preview URL setting", {
          description: error.message,
        });
      },
    });

  const handleTogglePreviewUrl = useCallback(() => {
    if (!projectSlug) return;
    setPublicPreviewEnabledMutation.mutate({
      slug: projectSlug,
      enabled: !publicPreviewEnabled,
    });
  }, [projectSlug, publicPreviewEnabled, setPublicPreviewEnabledMutation]);

  // Connected-mode only: regenerate thumbnail
  const regenerateThumbnailMutation =
    trpc.project.regenerateThumbnail.useMutation({
      onSuccess: () => {
        toast.success("Thumbnail regeneration requested");
      },
      onError: (error) => {
        toast.error("Failed to regenerate thumbnail", {
          description: error.message,
        });
      },
    });

  const handleRegenerateThumbnail = useCallback(() => {
    if (!projectSlug) return;
    regenerateThumbnailMutation.mutate({
      slug: projectSlug,
      version: selectedVersion,
    });
  }, [projectSlug, selectedVersion, regenerateThumbnailMutation]);

  // Connected-mode only: delete project
  const deleteProjectMutation = trpc.project.deleteProject.useMutation({
    onSuccess: () => {
      toast.success("Project deleted");
      handleClose?.();
    },
    onError: (error) => {
      toast.error("Failed to delete project", {
        description: error.message,
      });
    },
  });

  const handleDeleteProject = useCallback(() => {
    if (!projectSlug) return;
    deleteProjectMutation.mutate({ slug: projectSlug });
  }, [projectSlug, deleteProjectMutation]);

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
    sessionHistoryOpen,
    setSessionHistoryOpen,
    viewportMode,
    setViewportMode,
    selectedDevice,
    setSelectedDevice,
    editMode,
    hasUnsavedChanges,
    fullUrl,
    currentPreviewPath,
    versions,
    hasMultipleVersions,
    analyticsAvailable,
    handleVersionSelect,
    handleCopy,
    handleRefresh,
    navigatePreviewPath,
    toggleEditMode,
    assetsOpen,
    setAssetsOpen,
    pluginsOpen,
    setPluginsOpen,
    chatOpen,
    chatPanel,
    setChatOpen,
    handleClose,
    embedded,
    publicPreviewEnabled,
    previewMode,

    // Query data
    hasGitChanges,
    isPublished,
    publishStatus,

    // Mutations
    handleLoadVersion,
    isLoadingVersion: loadVersionMutation.isPending,
    loadingVersionHash,

    // Connected-mode actions
    isConnectedMode,
    handleTogglePreviewUrl,
    isTogglingPreviewUrl: setPublicPreviewEnabledMutation.isPending,
    handleRegenerateThumbnail,
    isRegeneratingThumbnail: regenerateThumbnailMutation.isPending,
    handleDeleteProject,
    isDeletingProject: deleteProjectMutation.isPending,

    // Dev server actions
    handleRestartDevServer,
    isRestartingDevServer: restartDevServerMutation.isPending,
    devServerRestartKind,

    // Utils for cache invalidation
    utils,
  };
}

export type ToolbarState = ReturnType<typeof useToolbarState>;
