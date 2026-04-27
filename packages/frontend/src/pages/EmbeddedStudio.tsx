import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { useSidebar } from "@/components/ui/sidebar";
import { Button, Panel } from "@vivd/ui";

import { useTheme } from "@/components/theme";
import { ROUTES } from "@/app/router";
import { CenteredLoading } from "@/components/common";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import {
  FramedHostShell,
  HOST_VIEWPORT_INSET_CLASS,
  FramedViewport,
} from "@/components/common/FramedHostShell";
import { PublishSiteDialog } from "@/components/projects/publish/PublishSiteDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { listEnabledNativeProjectPluginPresentations } from "@/plugins/presentation";
import {
  type StudioRuntimeSession,
  useStudioHostRuntime,
} from "@/hooks/useStudioHostRuntime";
import { useStudioIframeLifecycle } from "@/hooks/useStudioIframeLifecycle";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import { createStudioRuntimeSession } from "@/lib/studioRuntimeSession";
import { EmbeddedStudioHeader } from "./embeddedStudio/EmbeddedStudioHeader";
import { EmbeddedStudioLiveSurface } from "./embeddedStudio/EmbeddedStudioLiveSurface";
import { EmbeddedStudioProjectDialogs } from "./embeddedStudio/EmbeddedStudioProjectDialogs";
import { toast } from "sonner";

const EMBEDDED_PROJECT_HEADER_INSET_CLASS = "pl-2 pr-3 py-1 md:pl-2.5 md:pr-4";

/**
 * EmbeddedStudio - Project page inside the main app shell.
 *
 * Default: show a fast, prebuilt preview (or placeholder).
 * User clicks "Start Studio" to boot a studio machine and embed it in an iframe.
 */
export default function EmbeddedStudio() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, colorTheme, setTheme, setColorTheme } = useTheme();
  const {
    toggleSidebar,
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    setOpenMobile: setSidebarOpenMobile,
    showImmersivePeek,
    scheduleHideImmersivePeek,
  } = useSidebar();
  const [editRequested, setEditRequested] = useState(false);
  const [previewSurface, setPreviewSurface] = useState<"live" | "publish">(
    "publish",
  );
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [previewUrlCopied, setPreviewUrlCopied] = useState(false);
  const studioIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Fetch project data to get current version
  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const version = project?.currentVersion || 1;
  const publicPreviewEnabled = project?.publicPreviewEnabled ?? true;
  const enabledPluginEntries = projectSlug
    ? listEnabledNativeProjectPluginPresentations({
        enabledPluginIds: project?.enabledPlugins ?? [],
        projectSlug,
      })
    : [];

  const urlParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const resumeStudio = urlParams.get("view") === "studio";
  const versionOverrideRaw = urlParams.get("version");
  const initialGenerationRequested = urlParams.get("initialGeneration") === "1";
  const requestedInitialSessionId = urlParams.get("sessionId")?.trim() || null;
  const versionOverride = versionOverrideRaw
    ? Number.parseInt(versionOverrideRaw, 10)
    : NaN;
  const studioVersion =
    Number.isFinite(versionOverride) && versionOverride > 0
      ? versionOverride
      : version;
  const { data: projectStatusData } = trpc.project.status.useQuery(
    { slug: projectSlug!, version: studioVersion },
    {
      enabled: !!projectSlug && (initialGenerationRequested || resumeStudio),
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
      refetchInterval: (query) => {
        const status =
          query.state.data && "status" in query.state.data
            ? query.state.data.status
            : null;
        const sessionId =
          query.state.data && "studioHandoff" in query.state.data
            ? (query.state.data.studioHandoff?.sessionId ?? null)
            : null;
        const shouldTrackInitialGeneration =
          initialGenerationRequested ||
          (resumeStudio &&
            (status === "generating_initial_site" ||
              status === "initial_generation_paused"));
        return shouldTrackInitialGeneration &&
          !requestedInitialSessionId &&
          status !== "initial_generation_paused" &&
          status !== "completed" &&
          status !== "failed" &&
          sessionId == null
          ? 1_000
          : false;
      },
    },
  );
  const projectInitialGenerationStatus =
    projectStatusData && "status" in projectStatusData
      ? projectStatusData.status
      : null;
  const shouldAutoResumeInitialGeneration =
    !initialGenerationRequested &&
    resumeStudio &&
    (projectInitialGenerationStatus === "generating_initial_site" ||
      projectInitialGenerationStatus === "initial_generation_paused");
  const effectiveInitialGenerationRequested =
    initialGenerationRequested || shouldAutoResumeInitialGeneration;
  const shouldResumeStudio =
    resumeStudio || effectiveInitialGenerationRequested;
  const canBootstrapStudio = Boolean(
    project || initialGenerationRequested || shouldAutoResumeInitialGeneration,
  );
  const initialGenerationStatus =
    effectiveInitialGenerationRequested && projectInitialGenerationStatus
      ? projectInitialGenerationStatus
      : null;
  const polledInitialSessionId =
    effectiveInitialGenerationRequested &&
    projectStatusData &&
    "studioHandoff" in projectStatusData
      ? projectStatusData.studioHandoff?.sessionId?.trim() || null
      : null;
  const resolvedInitialSessionId =
    requestedInitialSessionId ?? polledInitialSessionId;
  const awaitingInitialGenerationHandoff =
    effectiveInitialGenerationRequested &&
    !resolvedInitialSessionId &&
    initialGenerationStatus !== "initial_generation_paused" &&
    initialGenerationStatus !== "completed" &&
    initialGenerationStatus !== "failed";

  useEffect(() => {
    if (!projectSlug || !shouldAutoResumeInitialGeneration) return;

    const params = new URLSearchParams(location.search);
    if (params.get("initialGeneration") === "1") return;

    params.set("initialGeneration", "1");
    if (polledInitialSessionId) {
      params.set("sessionId", polledInitialSessionId);
    }

    navigate(`${ROUTES.PROJECT(projectSlug)}?${params.toString()}`, {
      replace: true,
    });
  }, [
    location.search,
    navigate,
    polledInitialSessionId,
    projectSlug,
    shouldAutoResumeInitialGeneration,
  ]);

  const utils = trpc.useUtils();
  const startStudio = trpc.project.startStudio.useMutation({
    onSuccess: () => {
      if (!projectSlug) return;
      utils.project.getStudioUrl.invalidate({
        slug: projectSlug,
        version: studioVersion,
      });
    },
  });
  const hardRestartStudio = trpc.project.hardRestartStudio.useMutation({
    onSuccess: () => {
      if (!projectSlug) return;
      utils.project.getStudioUrl.invalidate({
        slug: projectSlug,
        version: studioVersion,
      });
    },
  });
  const shouldPollStudioStatus =
    (editRequested || shouldResumeStudio) && !hardRestartStudio.isPending;
  const touchStudio = trpc.project.touchStudio.useMutation();
  const studioUrlQuery = trpc.project.getStudioUrl.useQuery(
    { slug: projectSlug!, version: studioVersion },
    {
      enabled: !!projectSlug && canBootstrapStudio,
      // This is a lightweight status check; prefer correctness over caching so we can
      // resume an already-running studio after navigation (or after fullscreen toggles).
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
      refetchInterval: (query) =>
        shouldPollStudioStatus && query.state.data?.status !== "running"
          ? 1_000
          : false,
    },
  );
  const { data: externalPreview } =
    trpc.project.getExternalPreviewStatus.useQuery(
      { slug: projectSlug!, version: studioVersion },
      { enabled: !!projectSlug && !!project },
    );
  const regenerateThumbnailMutation =
    trpc.project.regenerateThumbnail.useMutation({
      onSuccess: (_data, variables) => {
        toast.success("Thumbnail regenerated", {
          description: `${variables.slug} v${variables.version}`,
        });
        utils.project.list.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to regenerate thumbnail", {
          description: error.message,
        });
      },
    });
  const setPublicPreviewEnabledMutation =
    trpc.project.setPublicPreviewEnabled.useMutation({
      onSuccess: (data) => {
        toast.success(
          data.publicPreviewEnabled
            ? "Preview URL enabled"
            : "Preview URL disabled",
        );
        utils.project.list.invalidate();
      },
      onError: (error) => {
        toast.error("Failed to update preview URL setting", {
          description: error.message,
        });
      },
    });
  const deleteProjectMutation = trpc.project.delete.useMutation({
    onSuccess: (data) => {
      toast.success("Project Deleted", { description: data.message });
      navigate(ROUTES.DASHBOARD);
    },
    onError: (error) => {
      toast.error("Failed to delete project", {
        description: error.message,
      });
    },
  });
  const renameSlugMutation = trpc.project.renameSlug.useMutation({
    onSuccess: (data) => {
      toast.success("Project renamed", {
        description: `${data.oldSlug} -> ${data.newSlug}`,
      });
      setShowRenameDialog(false);
      utils.project.list.invalidate();
      navigate(`${ROUTES.PROJECT(data.newSlug)}${location.search}`, {
        replace: true,
      });
    },
    onError: (error) => {
      toast.error("Failed to rename project", {
        description: error.message,
      });
    },
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameSlugInput, setRenameSlugInput] = useState(projectSlug ?? "");
  const { isAdmin } = usePermissions();
  const canManagePreview = isAdmin;
  const canRenameProject = isAdmin;
  const canDeleteProject = isAdmin;
  const isRenamePending = renameSlugMutation.isPending;
  const queryStudioRuntime = useMemo<StudioRuntimeSession | null>(() => {
    if (studioUrlQuery.data?.status !== "running") return null;
    return createStudioRuntimeSession(studioUrlQuery.data);
  }, [studioUrlQuery.data]);

  const startedStudioRuntime = useMemo<StudioRuntimeSession | null>(() => {
    if (!startStudio.data?.success) return null;
    return createStudioRuntimeSession(startStudio.data);
  }, [startStudio.data]);

  const preferredStudioRuntime = useMemo(
    () =>
      editRequested
        ? (startedStudioRuntime ?? queryStudioRuntime)
        : queryStudioRuntime,
    [editRequested, queryStudioRuntime, startedStudioRuntime],
  );

  const ensureStudioRunning = useCallback(async () => {
    if (!projectSlug) {
      return {
        success: false as const,
        error: "Missing project slug",
      };
    }
    return startStudio.mutateAsync({
      slug: projectSlug,
      version: studioVersion,
    });
  }, [projectSlug, startStudio, studioVersion]);

  const refreshStudioRuntime = useCallback(async () => {
    if (!projectSlug) return null;

    const result = await studioUrlQuery.refetch();
    if (result.data?.status !== "running") return null;
    return createStudioRuntimeSession(result.data);
  }, [projectSlug, studioUrlQuery]);

  const {
    studioBaseUrl,
    studioHostProbeBaseUrl,
    studioBootstrapToken,
    studioBootstrapStatusUrl,
    studioUserActionToken,
    studioBootstrapAction,
    reloadNonce: studioReloadNonce,
    isStudioRecovering,
    requestStudioRecoveryCheck,
    replaceRuntime,
    clearRuntimeOverride,
    reloadStudioIframe,
  } = useStudioHostRuntime({
    resetKey: `${projectSlug || "project"}:v${studioVersion}`,
    runtime: preferredStudioRuntime,
    suspendRuntime: hardRestartStudio.isPending,
    refreshRuntime: refreshStudioRuntime,
    touchStudio: () => {
      if (!projectSlug) return;
      touchStudio.mutate({ slug: projectSlug, version: studioVersion });
    },
    ensureStudioRunning,
    invalidateRuntime: () =>
      projectSlug
        ? utils.project.getStudioUrl.invalidate({
            slug: projectSlug,
            version: studioVersion,
          })
        : undefined,
    onRecoveryError: (message) => {
      toast.error("Failed to wake studio", { description: message });
    },
  });

  useEffect(() => {
    setEditRequested(false);
    setPreviewSurface("publish");
    startStudio.reset();
    hardRestartStudio.reset();
  }, [projectSlug, startStudio.reset, hardRestartStudio.reset]);

  useEffect(() => {
    setRenameSlugInput(projectSlug ?? "");
  }, [projectSlug]);

  // If we navigated back from fullscreen with `?view=studio`, prefer showing the running studio.
  useEffect(() => {
    if (shouldResumeStudio && studioUrlQuery.data?.status === "running") {
      setEditRequested(false);
      setPreviewSurface("live");
    }
  }, [shouldResumeStudio, studioUrlQuery.data?.status]);

  // Set document title to project name
  useEffect(() => {
    const projectLabel = project?.title ?? project?.slug ?? projectSlug;
    if (projectLabel) {
      document.title = formatDocumentTitle(projectLabel);
    }
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [project?.slug, project?.title, projectSlug]);

  const handleEdit = () => {
    if (!projectSlug || !project) return;
    if (isRenamePending) return;
    if (editRequested || startStudio.isPending || hardRestartStudio.isPending)
      return;
    setSidebarOpen(false);
    setSidebarOpenMobile(false);
    setPreviewSurface("live");
    setEditRequested(true);
    clearRuntimeOverride();
    startStudio.mutate({ slug: projectSlug, version: studioVersion });
  };

  useEffect(() => {
    if (
      !effectiveInitialGenerationRequested ||
      !projectSlug ||
      !canBootstrapStudio
    ) {
      return;
    }
    setPreviewSurface("live");
    setEditRequested(true);

    if (awaitingInitialGenerationHandoff) return;
    if (studioUrlQuery.data?.status === "running") return;
    if (editRequested || startStudio.isPending || startStudio.data) return;
    if (hardRestartStudio.isPending || isRenamePending) return;

    clearRuntimeOverride();
    startStudio.mutate({ slug: projectSlug, version: studioVersion });
  }, [
    awaitingInitialGenerationHandoff,
    clearRuntimeOverride,
    editRequested,
    hardRestartStudio.isPending,
    effectiveInitialGenerationRequested,
    isRenamePending,
    canBootstrapStudio,
    projectSlug,
    startStudio,
    startStudio.data,
    startStudio.isPending,
    studioUrlQuery.data?.status,
    studioVersion,
  ]);

  const handleHardRestart = async (requestedVersion?: number) => {
    if (!projectSlug || !project) return;
    if (isRenamePending) return;

    const targetVersion =
      typeof requestedVersion === "number" &&
      Number.isFinite(requestedVersion) &&
      requestedVersion > 0
        ? requestedVersion
        : studioVersion;

    setPreviewSurface("live");
    setEditRequested(true);
    clearRuntimeOverride();

    try {
      const result = await hardRestartStudio.mutateAsync({
        slug: projectSlug,
        version: targetVersion,
      });
      if (!result.success) {
        toast.error("Failed to restart studio", {
          description: result.error || "Unknown error",
        });
        return;
      }

      replaceRuntime(createStudioRuntimeSession(result), { reload: true });
      toast.success("Studio restarted");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to restart studio", { description: message });
    }
  };

  const {
    studioVisible,
    studioReady,
    studioLoadErrored,
    studioLoadTimedOut,
    studioLoadError,
    handleStudioIframeLoad,
    handleStudioIframeError,
  } = useStudioIframeLifecycle({
    iframeRef: studioIframeRef,
    studioBaseUrl,
    studioHostProbeBaseUrl,
    reloadNonce: studioReloadNonce,
    reloadStudioIframe,
    allowCrossOriginNavigationPresentation: !(
      studioBootstrapAction && studioBootstrapToken
    ),
    sidebarOpen,
    theme,
    colorTheme,
    setTheme,
    setColorTheme,
    onClose: () => {
      navigate(ROUTES.DASHBOARD);
    },
    onFullscreen: () => {
      const params = new URLSearchParams({
        version: String(studioVersion),
        ...(effectiveInitialGenerationRequested
          ? { initialGeneration: "1" }
          : {}),
      });
      if (resolvedInitialSessionId) {
        params.set("sessionId", resolvedInitialSessionId);
      }
      navigate(
        `${ROUTES.PROJECT_STUDIO_FULLSCREEN(projectSlug!)}?${params.toString()}`,
      );
    },
    onNavigate: (path) => {
      navigate(path);
    },
    onShowSidebarPeek: showImmersivePeek,
    onScheduleHideSidebarPeek: scheduleHideImmersivePeek,
    onToggleSidebar: toggleSidebar,
    onHardRestart: (nextVersion) => {
      void handleHardRestart(nextVersion);
    },
    onTransportDegraded: requestStudioRecoveryCheck,
  });

  const studioIframeSrc = useMemo(() => {
    const liveStudioBaseUrl = studioBaseUrl;
    if (!liveStudioBaseUrl || awaitingInitialGenerationHandoff) return null;

    const url = new URL(
      resolveStudioRuntimeUrl(liveStudioBaseUrl, "vivd-studio"),
    );
    url.searchParams.set("embedded", "1");
    url.searchParams.set("projectSlug", projectSlug || "");
    url.searchParams.set("version", String(studioVersion));
    url.searchParams.set(
      "publicPreviewEnabled",
      publicPreviewEnabled ? "1" : "0",
    );
    url.searchParams.set("sidebarOpen", sidebarOpen ? "1" : "0");
    if (effectiveInitialGenerationRequested) {
      url.searchParams.set("initialGeneration", "1");
    }
    if (resolvedInitialSessionId) {
      url.searchParams.set("sessionId", resolvedInitialSessionId);
    }
    // Origin of the host app – used by the studio to construct shareable preview URLs.
    url.searchParams.set("hostOrigin", window.location.origin);
    // Used by the "fullscreen/open in new tab" studio view to navigate back.
    const returnToParams = new URLSearchParams({
      view: "studio",
      version: String(studioVersion),
      ...(effectiveInitialGenerationRequested
        ? { initialGeneration: "1" }
        : {}),
    });
    if (resolvedInitialSessionId) {
      returnToParams.set("sessionId", resolvedInitialSessionId);
    }
    url.searchParams.set(
      "returnTo",
      new URL(
        `${ROUTES.PROJECT(projectSlug || "")}?${returnToParams.toString()}`,
        window.location.origin,
      ).toString(),
    );
    return url.toString();
  }, [
    awaitingInitialGenerationHandoff,
    effectiveInitialGenerationRequested,
    projectSlug,
    publicPreviewEnabled,
    resolvedInitialSessionId,
    sidebarOpen,
    studioBaseUrl,
    studioVersion,
  ]);

  const studioIframeTarget = useMemo(
    () => `vivd-studio-embedded-${projectSlug || "project"}-v${studioVersion}`,
    [projectSlug, studioVersion],
  );

  const studioIframeRequestKey = `${projectSlug}-${studioVersion}-${studioBaseUrl ?? ""}-${studioReloadNonce}`;

  const previewIframeSrc = useMemo(() => {
    if (!projectSlug || !project) return null;
    if (externalPreview?.status !== "ready") return null;
    return externalPreview.url;
  }, [externalPreview, projectSlug, project]);

  // A running studio should always take over the embedded surface, even without
  // an explicit `?view=studio` hint, so revisiting a project auto-resumes Studio.
  const livePreviewActive =
    previewSurface === "live" || Boolean(studioIframeSrc);

  const handleCopyPreviewUrl = () => {
    if (isRenamePending) return;
    if (!externalPreview || externalPreview.status !== "ready") return;
    const absoluteUrl = new URL(
      externalPreview.canonicalUrl ?? externalPreview.url,
      window.location.origin,
    ).toString();

    navigator.clipboard
      .writeText(absoluteUrl)
      .then(() => {
        setPreviewUrlCopied(true);
        setTimeout(() => setPreviewUrlCopied(false), 2000);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to copy preview URL", { description: message });
      });
  };

  const handleRegenerateThumbnail = () => {
    if (isRenamePending) return;
    if (!projectSlug) return;
    regenerateThumbnailMutation.mutate({
      slug: projectSlug,
      version: studioVersion,
    });
  };

  const handleTogglePublicPreview = () => {
    if (!projectSlug) return;
    setPublicPreviewEnabledMutation.mutate({
      slug: projectSlug,
      enabled: !publicPreviewEnabled,
    });
  };

  const handleDownloadZip = () => {
    if (!projectSlug) return;
    const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
    window.open(
      `${baseUrl}/vivd-studio/api/download/${projectSlug}/${studioVersion}`,
      "_blank",
    );
  };

  const handleOpenPlugins = () => {
    if (!projectSlug) return;
    navigate(ROUTES.PROJECT_PLUGINS(projectSlug));
  };

  const handleOpenRename = () => {
    setRenameSlugInput(projectSlug ?? "");
    setShowRenameDialog(true);
  };

  const handleRenameProject = () => {
    if (!projectSlug) return;
    const nextSlug = renameSlugInput.trim();
    renameSlugMutation.mutate({
      oldSlug: projectSlug,
      newSlug: nextSlug,
      confirmationText: nextSlug,
    });
  };

  const handleDeleteProject = () => {
    if (!projectSlug) return;
    deleteProjectMutation.mutate({
      slug: projectSlug,
      confirmationText: projectSlug,
    });
    setShowDeleteConfirm(false);
  };

  const thumbnailSrc = useMemo(() => {
    return project?.thumbnailUrl ?? null;
  }, [project?.thumbnailUrl]);
  const selectedVersionInfo = project?.versions?.find(
    (v) => v.version === studioVersion,
  );
  const isSelectedVersionCompleted =
    selectedVersionInfo?.status === "completed" ||
    (studioVersion === project?.currentVersion &&
      project?.status === "completed");
  const showStudioStartupAction =
    startStudio.isPending ||
    hardRestartStudio.isPending ||
    isStudioRecovering ||
    (livePreviewActive && (!studioIframeSrc || !studioVisible));
  const studioStartupStatusLabel = hardRestartStudio.isPending
    ? "Restarting studio..."
    : "Starting studio...";

  const renderEmbeddedHeader = ({
    includeProjectActions = false,
    studioStatusLabel,
  }: {
    includeProjectActions?: boolean;
    studioStatusLabel?: string;
  }) => (
    <EmbeddedStudioHeader
      projectSlug={projectSlug}
      sidebarOpen={sidebarOpen}
      includeProjectActions={includeProjectActions}
      studioStatusLabel={studioStatusLabel}
      showStudioStartupAction={showStudioStartupAction}
      isHardRestartPending={hardRestartStudio.isPending}
      isStudioRecovering={isStudioRecovering}
      isRenamePending={isRenamePending}
      previewIframeSrc={previewIframeSrc}
      publicPreviewEnabled={publicPreviewEnabled}
      previewUrlCopied={previewUrlCopied}
      canManagePreview={canManagePreview}
      isTogglePublicPreviewPending={setPublicPreviewEnabledMutation.isPending}
      projectOriginalUrl={project?.url}
      canDownloadSelectedVersion={isSelectedVersionCompleted}
      isRegenerateThumbnailPending={regenerateThumbnailMutation.isPending}
      canRenameProject={canRenameProject}
      canDeleteProject={canDeleteProject}
      enabledPluginEntries={enabledPluginEntries}
      onEdit={handleEdit}
      onOpenPublish={() => setPublishDialogOpen(true)}
      onOpenPlugins={handleOpenPlugins}
      onNavigate={(path) => navigate(path)}
      onCopyPreviewUrl={handleCopyPreviewUrl}
      onTogglePublicPreview={handleTogglePublicPreview}
      onDownloadZip={handleDownloadZip}
      onRegenerateThumbnail={handleRegenerateThumbnail}
      onOpenRename={handleOpenRename}
      onOpenDelete={() => setShowDeleteConfirm(true)}
    />
  );

  if (isLoading) {
    return <CenteredLoading message="Loading project..." />;
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-destructive">
          Error loading project: {error.message}
        </div>
      </div>
    );
  }

  if (!projectSlug) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  if (!project && effectiveInitialGenerationRequested) {
    return (
      <FramedHostShell
        className="h-full"
        header={renderEmbeddedHeader({
          studioStatusLabel: "Starting studio...",
        })}
        headerClassName={EMBEDDED_PROJECT_HEADER_INSET_CLASS}
      >
        <div className="relative flex h-full min-h-0 flex-col bg-background">
          <StudioStartupLoading className="h-full min-h-0" />
        </div>
      </FramedHostShell>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  if (startStudio.error) {
    return (
      <FramedHostShell
        className="h-full"
        header={renderEmbeddedHeader({})}
        headerClassName={EMBEDDED_PROJECT_HEADER_INSET_CLASS}
      >
        <div className={HOST_VIEWPORT_INSET_CLASS}>
          <FramedViewport className="flex items-center justify-center">
            <div className="px-6 text-center text-destructive">
              Error starting studio: {startStudio.error.message}
            </div>
          </FramedViewport>
        </div>
      </FramedHostShell>
    );
  }

  if (startStudio.data && !startStudio.data.success) {
    return (
      <FramedHostShell
        className="h-full"
        header={renderEmbeddedHeader({})}
        headerClassName={EMBEDDED_PROJECT_HEADER_INSET_CLASS}
      >
        <div className={HOST_VIEWPORT_INSET_CLASS}>
          <FramedViewport className="flex flex-col items-center justify-center gap-3">
            <div className="px-6 text-center text-destructive">
              Failed to start studio:{" "}
              {startStudio.data.error || "Unknown error"}
            </div>
            <Button
              onClick={handleEdit}
              size="sm"
              className="h-8 rounded-md px-3"
            >
              Retry
            </Button>
          </FramedViewport>
        </div>
      </FramedHostShell>
    );
  }

  if (editRequested && !studioIframeSrc) {
    return (
      <FramedHostShell
        className="h-full"
        header={renderEmbeddedHeader({
          includeProjectActions: true,
          studioStatusLabel: hardRestartStudio.isPending
            ? "Restarting studio..."
            : "Starting studio...",
        })}
        headerClassName={EMBEDDED_PROJECT_HEADER_INSET_CLASS}
      >
        <div className="relative flex h-full min-h-0 flex-col bg-background">
          <StudioStartupLoading className="h-full min-h-0" />
        </div>
      </FramedHostShell>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {livePreviewActive && studioIframeSrc ? (
        <EmbeddedStudioLiveSurface
          projectSlug={projectSlug}
          studioIframeRef={studioIframeRef}
          studioIframeTarget={studioIframeTarget}
          studioIframeRequestKey={studioIframeRequestKey}
          studioIframeSrc={studioIframeSrc}
          studioBootstrapAction={studioBootstrapAction}
          studioBootstrapStatusUrl={studioBootstrapStatusUrl}
          studioBootstrapToken={studioBootstrapToken}
          studioUserActionToken={studioUserActionToken}
          studioVisible={studioVisible}
          studioReady={studioReady}
          studioLoadErrored={studioLoadErrored}
          studioLoadTimedOut={studioLoadTimedOut}
          studioLoadError={studioLoadError}
          onStudioIframeLoad={handleStudioIframeLoad}
          onStudioIframeError={handleStudioIframeError}
          onReloadStudioIframe={reloadStudioIframe}
          onHardRestart={handleHardRestart}
          isHardRestartPending={hardRestartStudio.isPending}
          isStudioRecovering={isStudioRecovering}
          startupHeader={renderEmbeddedHeader({
            includeProjectActions: true,
            studioStatusLabel: studioStartupStatusLabel,
          })}
          startupHeaderClassName={EMBEDDED_PROJECT_HEADER_INSET_CLASS}
        />
      ) : (
        <FramedHostShell
          className="h-full"
          header={renderEmbeddedHeader({ includeProjectActions: true })}
          headerClassName={EMBEDDED_PROJECT_HEADER_INSET_CLASS}
        >
          <div className={HOST_VIEWPORT_INSET_CLASS}>
            <FramedViewport>
              {previewIframeSrc ? (
                <iframe
                  key={`${projectSlug}-${version}-preview`}
                  src={previewIframeSrc}
                  title={`Preview - ${projectSlug}`}
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <div className="flex w-full max-w-4xl flex-col gap-4">
                    <div className="text-sm text-muted-foreground">
                      Publish preview not ready yet
                      {externalPreview?.status
                        ? ` (${externalPreview.status})`
                        : ""}
                      . Click{" "}
                      <span className="font-medium text-foreground">
                        Start Studio
                      </span>{" "}
                      to start a studio machine.
                    </div>
                    {thumbnailSrc ? (
                      <Panel
                        tone="sunken"
                        className="overflow-hidden rounded-md p-0"
                      >
                        <img
                          src={thumbnailSrc}
                          alt={`Thumbnail - ${projectSlug}`}
                          className="h-auto w-full object-contain"
                          loading="lazy"
                        />
                      </Panel>
                    ) : null}
                  </div>
                </div>
              )}
            </FramedViewport>
          </div>
        </FramedHostShell>
      )}

      {!studioIframeSrc ? (
        <PublishSiteDialog
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          slug={projectSlug}
          version={studioVersion}
          onOpenStudio={handleEdit}
        />
      ) : null}

      <EmbeddedStudioProjectDialogs
        projectSlug={projectSlug}
        showRenameDialog={showRenameDialog}
        onShowRenameDialogChange={setShowRenameDialog}
        showDeleteConfirm={showDeleteConfirm}
        onShowDeleteConfirmChange={setShowDeleteConfirm}
        renameSlugInput={renameSlugInput}
        onRenameSlugInputChange={setRenameSlugInput}
        isRenamePending={isRenamePending}
        isDeletePending={deleteProjectMutation.isPending}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
      />
    </div>
  );
}
