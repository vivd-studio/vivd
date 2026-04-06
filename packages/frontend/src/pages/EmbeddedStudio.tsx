import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useTheme } from "@/components/theme";
import { HeaderBreadcrumbTextLink, HostHeader } from "@/components/shell";
import { ROUTES } from "@/app/router";
import { CenteredLoading } from "@/components/common";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import {
  FramedHostShell,
  HOST_VIEWPORT_INSET_CLASS,
  FramedViewport,
} from "@/components/common/FramedHostShell";
import { PublishSiteDialog } from "@/components/projects/publish/PublishSiteDialog";
import { StudioBootstrapIframe } from "@/components/common/StudioBootstrapIframe";
import { authClient } from "@/lib/auth-client";
import {
  type StudioRuntimeSession,
  useStudioHostRuntime,
} from "@/hooks/useStudioHostRuntime";
import { useStudioIframeLifecycle } from "@/hooks/useStudioIframeLifecycle";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import { createStudioRuntimeSession } from "@/lib/studioRuntimeSession";
import { toast } from "sonner";
import {
  BarChart3,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Image,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plug,
  Trash2,
} from "lucide-react";

const EMBEDDED_PROJECT_HEADER_INSET_CLASS =
  "pl-2 pr-3 py-1 md:pl-2.5 md:pr-4";

/**
 * EmbeddedStudio - Project page inside the main app shell.
 *
 * Default: show a fast, prebuilt preview (or placeholder).
 * User clicks "Edit" to start a studio machine and embed it in an iframe.
 */
export default function EmbeddedStudio() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, colorTheme, setTheme, setColorTheme } = useTheme();
  const {
    toggleSidebar,
    open: sidebarOpen,
  } = useSidebar();
  const [editRequested, setEditRequested] = useState(false);
  const [previewSurface, setPreviewSurface] = useState<"live" | "publish">("publish");
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [previewUrlCopied, setPreviewUrlCopied] = useState(false);
  const studioIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Fetch project data to get current version
  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const version = project?.currentVersion || 1;
  const publicPreviewEnabled = project?.publicPreviewEnabled ?? true;
  const analyticsAvailable = (project?.enabledPlugins ?? []).includes("analytics");
  const analyticsPath = projectSlug
    ? ROUTES.PROJECT_ANALYTICS?.(projectSlug) ??
      `/vivd-studio/projects/${projectSlug}/analytics`
    : null;

  const urlParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const resumeStudio = urlParams.get("view") === "studio";
  const versionOverrideRaw = urlParams.get("version");
  const initialGenerationRequested = urlParams.get("initialGeneration") === "1";
  const requestedInitialSessionId = urlParams.get("sessionId")?.trim() || null;
  const versionOverride = versionOverrideRaw
    ? Number.parseInt(versionOverrideRaw, 10)
    : NaN;
  const studioVersion =
    Number.isFinite(versionOverride) && versionOverride > 0 ? versionOverride : version;
  const shouldResumeStudio = resumeStudio || initialGenerationRequested;
  const canBootstrapStudio = Boolean(project || initialGenerationRequested);

  const initialGenerationStatusQuery = trpc.project.status.useQuery(
    { slug: projectSlug!, version: studioVersion },
    {
      enabled: !!projectSlug && initialGenerationRequested,
      refetchInterval: (query) => {
        const polledSessionId =
          query.state.data && "studioHandoff" in query.state.data
            ? query.state.data.studioHandoff?.sessionId ?? null
            : null;
        return initialGenerationRequested &&
          !requestedInitialSessionId &&
          !polledSessionId
          ? 1_000
          : false;
      },
    },
  );
  const polledInitialSessionId =
    initialGenerationStatusQuery.data &&
    "studioHandoff" in initialGenerationStatusQuery.data
      ? initialGenerationStatusQuery.data.studioHandoff?.sessionId ?? null
      : null;
  const resolvedInitialSessionId =
    requestedInitialSessionId ?? polledInitialSessionId ?? null;

  const utils = trpc.useUtils();
  const startStudio = trpc.project.startStudio.useMutation({
    onSuccess: () => {
      if (!projectSlug) return;
      utils.project.getStudioUrl.invalidate({ slug: projectSlug, version: studioVersion });
    },
  });
  const hardRestartStudio = trpc.project.hardRestartStudio.useMutation({
    onSuccess: () => {
      if (!projectSlug) return;
      utils.project.getStudioUrl.invalidate({ slug: projectSlug, version: studioVersion });
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
  const { data: externalPreview } = trpc.project.getExternalPreviewStatus.useQuery(
    { slug: projectSlug!, version: studioVersion },
    { enabled: !!projectSlug && !!project },
  );
  const regenerateThumbnailMutation = trpc.project.regenerateThumbnail.useMutation({
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
  const { data: session } = authClient.useSession();
  const { data: membership } = trpc.organization.getMyMembership.useQuery(
    undefined,
    { enabled: !!session },
  );
  const canManagePreview = membership?.organizationRole !== "client_editor";
  const canRenameProject = membership?.organizationRole !== "client_editor";
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
        ? startedStudioRuntime ?? queryStudioRuntime
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
    return startStudio.mutateAsync({ slug: projectSlug, version: studioVersion });
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
    studioUserActionToken,
    studioBootstrapAction,
    reloadNonce: studioReloadNonce,
    isStudioRecovering,
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

  // Reset local state when navigating between projects.
  useEffect(() => {
    if (
      !initialGenerationRequested ||
      !projectSlug ||
      requestedInitialSessionId ||
      !resolvedInitialSessionId
    ) {
      return;
    }

    const params = new URLSearchParams(location.search);
    params.set("sessionId", resolvedInitialSessionId);
    navigate(`${ROUTES.PROJECT(projectSlug)}?${params.toString()}`, {
      replace: true,
    });
  }, [
    initialGenerationRequested,
    location.search,
    navigate,
    projectSlug,
    requestedInitialSessionId,
    resolvedInitialSessionId,
  ]);

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
    if (editRequested || startStudio.isPending || hardRestartStudio.isPending) return;
    setPreviewSurface("live");
    setEditRequested(true);
    clearRuntimeOverride();
    startStudio.mutate({ slug: projectSlug, version: studioVersion });
  };

  useEffect(() => {
    if (!initialGenerationRequested || !projectSlug || !canBootstrapStudio) return;
    if (studioUrlQuery.data?.status === "running") return;
    if (editRequested || startStudio.isPending || startStudio.data) return;
    if (hardRestartStudio.isPending || isRenamePending) return;

    setPreviewSurface("live");
    setEditRequested(true);
    clearRuntimeOverride();
    startStudio.mutate({ slug: projectSlug, version: studioVersion });
  }, [
    clearRuntimeOverride,
    editRequested,
    hardRestartStudio.isPending,
    initialGenerationRequested,
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
    studioReady,
    studioLoadTimedOut,
    studioLoadErrored,
    handleStudioIframeLoad,
    handleStudioIframeError,
  } = useStudioIframeLifecycle({
    iframeRef: studioIframeRef,
    studioBaseUrl,
    studioHostProbeBaseUrl,
    reloadNonce: studioReloadNonce,
    reloadStudioIframe,
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
        ...(initialGenerationRequested ? { initialGeneration: "1" } : {}),
      });
      if (resolvedInitialSessionId) {
        params.set("sessionId", resolvedInitialSessionId);
      }
      navigate(`${ROUTES.PROJECT_STUDIO_FULLSCREEN(projectSlug!)}?${params.toString()}`);
    },
    onNavigate: (path) => {
      navigate(path);
    },
    onToggleSidebar: toggleSidebar,
    onHardRestart: (nextVersion) => {
      void handleHardRestart(nextVersion);
    },
  });

  const studioIframeSrc = useMemo(() => {
    const liveStudioBaseUrl = studioBaseUrl;
    if (!liveStudioBaseUrl) return null;

    const url = new URL(resolveStudioRuntimeUrl(liveStudioBaseUrl, "vivd-studio"));
    url.searchParams.set("embedded", "1");
    url.searchParams.set("projectSlug", projectSlug || "");
    url.searchParams.set("version", String(studioVersion));
    url.searchParams.set("publicPreviewEnabled", publicPreviewEnabled ? "1" : "0");
    url.searchParams.set("sidebarOpen", sidebarOpen ? "1" : "0");
    if (initialGenerationRequested) {
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
      ...(initialGenerationRequested ? { initialGeneration: "1" } : {}),
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
    initialGenerationRequested,
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
  const livePreviewActive = previewSurface === "live" || Boolean(studioIframeSrc);

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
    regenerateThumbnailMutation.mutate({ slug: projectSlug, version: studioVersion });
  };

  const thumbnailSrc = useMemo(() => {
    return project?.thumbnailUrl ?? null;
  }, [project?.thumbnailUrl]);
  const selectedVersionInfo = project?.versions?.find(
    (v) => v.version === studioVersion,
  );
  const isSelectedVersionCompleted =
    selectedVersionInfo?.status === "completed" ||
    (studioVersion === project?.currentVersion && project?.status === "completed");

  const renderEmbeddedHeader = ({
    includeProjectActions = false,
    studioStatusLabel,
  }: {
    includeProjectActions?: boolean;
    studioStatusLabel?: string;
  }) => {
    const showStudioStartupAction =
      editRequested &&
      (startStudio.isPending ||
        hardRestartStudio.isPending ||
        !studioIframeSrc ||
        !studioReady);
    const projectActions = includeProjectActions ? (
      <>
        {!editRequested ? (
          <Button
            size="sm"
            onClick={handleEdit}
            disabled={
              startStudio.isPending ||
              hardRestartStudio.isPending ||
              isRenamePending
            }
            className="h-8 rounded-md px-3"
          >
            Edit
          </Button>
        ) : showStudioStartupAction ? (
          <Button size="sm" disabled className="h-8 rounded-md px-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {hardRestartStudio.isPending ? "Restarting..." : "Starting..."}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPublishDialogOpen(true)}
          disabled={isRenamePending}
          className="h-8 rounded-md px-3"
        >
          Publish
        </Button>
        {analyticsAvailable ? (
          <Button
            variant="outline"
            size="icon"
            onClick={() => analyticsPath && navigate(analyticsPath)}
            title="Analytics"
            disabled={isRenamePending}
            className="h-8 w-8 rounded-md"
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
        ) : null}
        <Separator orientation="vertical" className="mx-0.5 h-4" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md"
              disabled={isRenamePending}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Actions should stay in sync — see PROJECT_ACTIONS in @vivd/shared */}
            <DropdownMenuItem
              onClick={handleCopyPreviewUrl}
              disabled={
                !previewIframeSrc || !publicPreviewEnabled || isRenamePending
              }
            >
              <Copy className="mr-2 h-4 w-4" />
              {publicPreviewEnabled
                ? previewUrlCopied
                  ? "Copied!"
                  : "Copy preview URL"
                : "Preview URL disabled"}
            </DropdownMenuItem>
            {canManagePreview ? (
              <DropdownMenuItem
                onClick={() => {
                  if (!projectSlug) return;
                  setPublicPreviewEnabledMutation.mutate({
                    slug: projectSlug,
                    enabled: !publicPreviewEnabled,
                  });
                }}
                disabled={
                  setPublicPreviewEnabledMutation.isPending || isRenamePending
                }
              >
                {publicPreviewEnabled ? (
                  <EyeOff className="mr-2 h-4 w-4" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                {publicPreviewEnabled
                  ? "Disable preview URL"
                  : "Enable preview URL"}
              </DropdownMenuItem>
            ) : null}
            {project?.url ? (
              <DropdownMenuItem
                onClick={() => window.open(project.url, "_blank")}
                disabled={isRenamePending}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Original website
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => {
                if (!projectSlug) return;
                const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
                window.open(
                  `${baseUrl}/vivd-studio/api/download/${projectSlug}/${studioVersion}`,
                  "_blank",
                );
              }}
              disabled={!isSelectedVersionCompleted || isRenamePending}
            >
              <Download className="mr-2 h-4 w-4" />
              Download as ZIP
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleRegenerateThumbnail}
              disabled={
                !isSelectedVersionCompleted ||
                regenerateThumbnailMutation.isPending ||
                isRenamePending
              }
            >
              {regenerateThumbnailMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Image className="mr-2 h-4 w-4" />
              )}
              {regenerateThumbnailMutation.isPending
                ? "Regenerating thumbnail..."
                : "Regenerate thumbnail"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigate(ROUTES.PROJECT_PLUGINS(projectSlug!))}
              disabled={isRenamePending}
            >
              <Plug className="mr-2 h-4 w-4" />
              Plugins
            </DropdownMenuItem>
            {analyticsAvailable ? (
              <DropdownMenuItem
                onClick={() => analyticsPath && navigate(analyticsPath)}
                disabled={isRenamePending}
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                Analytics
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {canRenameProject ? (
              <DropdownMenuItem
                onClick={() => {
                  setRenameSlugInput(projectSlug ?? "");
                  setShowRenameDialog(true);
                }}
                disabled={renameSlugMutation.isPending || isRenamePending}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename project slug
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => setShowDeleteConfirm(true)}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              disabled={isRenamePending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    ) : null;

    return (
      <HostHeader
        leadingAccessory={
          <SidebarTrigger
            appearance={sidebarOpen ? "panel" : "brand"}
            revealOnHover={false}
            className="rounded-md"
          />
        }
        leading={
          <>
            <div className="min-w-0 truncate text-sm font-medium sm:hidden">
              {projectSlug}
            </div>
            <Breadcrumb className="hidden sm:flex">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <HeaderBreadcrumbTextLink to={ROUTES.DASHBOARD}>
                    Projects
                  </HeaderBreadcrumbTextLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
                </BreadcrumbItem>
                {studioStatusLabel ? (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <span className="text-sm text-muted-foreground">
                        {studioStatusLabel}
                      </span>
                    </BreadcrumbItem>
                  </>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
          </>
        }
        trailing={
          <>
            {projectActions}
          </>
        }
      />
    );
  };

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

  if (!project && initialGenerationRequested) {
    return (
      <FramedHostShell
        className="h-full"
        header={renderEmbeddedHeader({ studioStatusLabel: "Starting studio..." })}
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
              Failed to start studio: {startStudio.data.error || "Unknown error"}
            </div>
            <Button onClick={handleEdit} size="sm" className="h-8 rounded-md px-3">
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
        <div className="relative flex-1 min-h-0">
          <div className="relative h-full w-full">
            <StudioBootstrapIframe
              iframeRef={studioIframeRef}
              iframeName={studioIframeTarget}
              iframeKey={studioIframeRequestKey}
              title={`Vivd Studio - ${projectSlug}`}
              cleanSrc={studioIframeSrc}
              bootstrapAction={studioBootstrapAction}
              bootstrapToken={studioBootstrapToken}
              userActionToken={studioUserActionToken}
              submissionKey={studioIframeRequestKey}
              className="h-full w-full border-0"
              allow="fullscreen; clipboard-write"
              allowFullScreen
              onLoad={handleStudioIframeLoad}
              onError={handleStudioIframeError}
            />

            {isStudioRecovering ? (
              <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                Reconnecting studio machine...
              </div>
            ) : null}

            {!studioReady ? (
              <div className="absolute inset-0 z-10 bg-background">
                {studioLoadTimedOut || studioLoadErrored ? (
                  <div className="flex h-full w-full items-center justify-center px-6">
                    <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
                      <div className="text-base font-semibold">
                        Studio is taking longer than usual
                      </div>
                      <div className="text-sm text-muted-foreground">
                        The studio machine may still be booting or it might be
                        unresponsive (common after restarts). Try reloading the
                        iframe or doing a hard restart.
                      </div>
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() => void reloadStudioIframe()}
                        >
                          Reload
                        </Button>
                        <Button
                          onClick={() => void handleHardRestart()}
                          disabled={hardRestartStudio.isPending}
                        >
                          {hardRestartStudio.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Restarting…
                            </>
                          ) : (
                            "Hard restart"
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <StudioStartupLoading
                    className="h-full min-h-0"
                    header={renderEmbeddedHeader({
                      includeProjectActions: true,
                      studioStatusLabel: hardRestartStudio.isPending
                        ? "Restarting studio..."
                        : "Starting studio...",
                    })}
                    headerClassName={EMBEDDED_PROJECT_HEADER_INSET_CLASS}
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>
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
                        : ""}. Click{" "}
                      <span className="font-medium text-foreground">Edit</span>{" "}
                      to start a studio machine.
                    </div>
                    {thumbnailSrc ? (
                      <div className="overflow-hidden rounded-lg border bg-muted">
                        <img
                          src={thumbnailSrc}
                          alt={`Thumbnail - ${projectSlug}`}
                          className="h-auto w-full object-contain"
                          loading="lazy"
                        />
                      </div>
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

      <AlertDialog
        open={showRenameDialog}
        onOpenChange={(open) => {
          if (isRenamePending) return;
          setShowRenameDialog(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename project slug?</AlertDialogTitle>
            <AlertDialogDescription>
              Change <strong>{projectSlug}</strong> to a new URL slug. This
              updates project references across the control plane. This can take
              a while and project actions stay locked until it completes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={renameSlugInput}
              onChange={(event) => setRenameSlugInput(event.target.value)}
              placeholder="new-project-slug"
              autoFocus
              disabled={isRenamePending}
            />
            {isRenamePending ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Renaming in progress. Please keep this page open.
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renameSlugMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                renameSlugMutation.isPending ||
                !projectSlug ||
                !renameSlugInput.trim() ||
                renameSlugInput.trim().toLowerCase() === projectSlug.toLowerCase()
              }
              onClick={() => {
                if (!projectSlug) return;
                const nextSlug = renameSlugInput.trim();
                renameSlugMutation.mutate({
                  oldSlug: projectSlug,
                  newSlug: nextSlug,
                  confirmationText: nextSlug,
                });
              }}
            >
              {renameSlugMutation.isPending ? "Renaming..." : "Rename slug"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{projectSlug}</strong> and
              all its versions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:border dark:border-destructive/40 dark:bg-destructive/12 dark:text-destructive dark:shadow-none dark:hover:bg-destructive/18 dark:hover:border-destructive/55"
              disabled={deleteProjectMutation.isPending}
              onClick={() => {
                if (!projectSlug) return;
                deleteProjectMutation.mutate({
                  slug: projectSlug,
                  confirmationText: projectSlug,
                });
                setShowDeleteConfirm(false);
              }}
            >
              {deleteProjectMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isRenamePending ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <div className="flex max-w-sm flex-col items-center gap-2 rounded-lg border bg-card px-4 py-3 text-center shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="text-sm font-medium">Renaming project slug...</div>
            <div className="text-xs text-muted-foreground">
              This may take a while. Project actions are temporarily disabled.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
