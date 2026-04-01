import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
import { CenteredLoading, VivdIcon } from "@/components/common";
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
  X,
} from "lucide-react";

/**
 * ProjectFullscreen
 *
 * Fullscreen project view without the app layout chrome.
 * Shows a fast, view-only preview by default and lets the user start the studio.
 *
 * Used for:
 * - client_editor accounts (assigned project fullscreen)
 * - single project mode redirects
 */
export default function ProjectFullscreen() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, colorTheme, setTheme, setColorTheme } = useTheme();
  const [editRequested, setEditRequested] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [previewUrlCopied, setPreviewUrlCopied] = useState(false);
  const studioIframeRef = useRef<HTMLIFrameElement | null>(null);

  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const currentVersion = project?.currentVersion || 1;
  const publicPreviewEnabled = project?.publicPreviewEnabled ?? true;
  const analyticsAvailable = (project?.enabledPlugins ?? []).includes("analytics");
  const analyticsPath = projectSlug
    ? ROUTES.PROJECT_ANALYTICS?.(projectSlug) ??
      `/vivd-studio/projects/${projectSlug}/analytics`
    : null;

  const urlParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const resumeStudio = urlParams.get("view") === "studio";
  const versionOverrideRaw = urlParams.get("version");
  const versionOverride = versionOverrideRaw
    ? Number.parseInt(versionOverrideRaw, 10)
    : NaN;
  const version =
    Number.isFinite(versionOverride) && versionOverride > 0
      ? versionOverride
      : currentVersion;

  const utils = trpc.useUtils();
  const startStudio = trpc.project.startStudio.useMutation({
    onSuccess: () => {
      if (!projectSlug) return;
      utils.project.getStudioUrl.invalidate({ slug: projectSlug, version });
    },
  });
  const hardRestartStudio = trpc.project.hardRestartStudio.useMutation({
    onSuccess: () => {
      if (!projectSlug) return;
      utils.project.getStudioUrl.invalidate({ slug: projectSlug, version });
    },
  });
  const touchStudio = trpc.project.touchStudio.useMutation();
  const studioUrlQuery = trpc.project.getStudioUrl.useQuery(
    { slug: projectSlug!, version },
    {
      enabled: !!projectSlug && !!project,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
    },
  );
  const { data: externalPreview } = trpc.project.getExternalPreviewStatus.useQuery(
    { slug: projectSlug!, version },
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
      navigate(`${ROUTES.PROJECT_FULLSCREEN(data.newSlug)}${location.search}`, {
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
    return startStudio.mutateAsync({ slug: projectSlug, version });
  }, [projectSlug, startStudio, version]);

  const refreshStudioRuntime = useCallback(async () => {
    if (!projectSlug) return null;

    const result = await studioUrlQuery.refetch();
    if (result.data?.status !== "running") return null;
    return createStudioRuntimeSession(result.data);
  }, [projectSlug, studioUrlQuery]);

  const {
    studioBaseUrl,
    studioBootstrapToken,
    studioUserActionToken,
    studioBootstrapAction,
    reloadNonce: studioReloadNonce,
    isStudioRecovering,
    replaceRuntime,
    clearRuntimeOverride,
    reloadStudioIframe,
  } = useStudioHostRuntime({
    resetKey: `${projectSlug || "project"}:v${version}`,
    runtime: preferredStudioRuntime,
    suspendRuntime: hardRestartStudio.isPending,
    refreshRuntime: refreshStudioRuntime,
    touchStudio: () => {
      if (!projectSlug) return;
      touchStudio.mutate({ slug: projectSlug, version });
    },
    ensureStudioRunning,
    invalidateRuntime: () =>
      projectSlug
        ? utils.project.getStudioUrl.invalidate({ slug: projectSlug, version })
        : undefined,
    onRecoveryError: (message) => {
      toast.error("Failed to wake studio", { description: message });
    },
  });

  useEffect(() => {
    setEditRequested(false);
    startStudio.reset();
    hardRestartStudio.reset();
  }, [projectSlug, startStudio.reset, hardRestartStudio.reset]);

  useEffect(() => {
    setRenameSlugInput(projectSlug ?? "");
  }, [projectSlug]);

  useEffect(() => {
    if (resumeStudio) {
      setEditRequested(false);
    }
  }, [resumeStudio]);

  useEffect(() => {
    if (project?.slug) {
      document.title = formatDocumentTitle(project.slug);
    }
    return () => {
      document.title = formatDocumentTitle();
    };
  }, [project?.slug]);

  const handleClose = () => {
    navigate(ROUTES.DASHBOARD);
  };

  const handleEdit = () => {
    if (!projectSlug || !project) return;
    if (isRenamePending) return;
    setEditRequested(true);
    clearRuntimeOverride();
    startStudio.mutate({ slug: projectSlug, version });
  };

  const handleHardRestart = async (requestedVersion?: number) => {
    if (!projectSlug || !project) return;
    if (isRenamePending) return;

    const targetVersion =
      typeof requestedVersion === "number" &&
      Number.isFinite(requestedVersion) &&
      requestedVersion > 0
        ? requestedVersion
        : version;

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
    reloadNonce: studioReloadNonce,
    reloadStudioIframe,
    theme,
    colorTheme,
    setTheme,
    setColorTheme,
    onClose: () => {
      navigate(ROUTES.DASHBOARD);
    },
    onFullscreen: () => {
      navigate(`${ROUTES.PROJECT_STUDIO_FULLSCREEN(projectSlug!)}?version=${version}`);
    },
    onNavigate: (path) => {
      navigate(path);
    },
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
    url.searchParams.set("version", String(version));
    url.searchParams.set("publicPreviewEnabled", publicPreviewEnabled ? "1" : "0");
    url.searchParams.set(
      "returnTo",
      new URL(ROUTES.PROJECT_FULLSCREEN(projectSlug || ""), window.location.origin).toString(),
    );
    return url.toString();
  }, [projectSlug, publicPreviewEnabled, studioBaseUrl, version]);

  const studioIframeTarget = useMemo(
    () => `vivd-studio-project-fullscreen-${projectSlug || "project"}-v${version}`,
    [projectSlug, version],
  );

  const studioIframeRequestKey = `${projectSlug}-${version}-${studioBaseUrl ?? ""}-${studioReloadNonce}`;

  const previewIframeSrc = useMemo(() => {
    if (!projectSlug || !project) return null;
    if (externalPreview?.status !== "ready") return null;
    return externalPreview.url;
  }, [externalPreview, projectSlug, project]);

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
    regenerateThumbnailMutation.mutate({ slug: projectSlug, version });
  };

  const thumbnailSrc = project?.thumbnailUrl ?? null;
  const selectedVersionInfo = project?.versions?.find((v) => v.version === version);
  const isSelectedVersionCompleted =
    selectedVersionInfo?.status === "completed" ||
    (version === project?.currentVersion && project?.status === "completed");

  const renderFullscreenHeader = ({
    actionSlot,
    includeProjectActions = false,
  }: {
    actionSlot?: ReactNode;
    includeProjectActions?: boolean;
  }) => {
    const projectActions = includeProjectActions ? (
      <>
        {!editRequested ? (
          <Button
            size="sm"
            onClick={handleEdit}
            disabled={isRenamePending}
            className="h-8 rounded-md px-3"
          >
            Edit
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
              {previewUrlCopied
                ? "Copied!"
                : publicPreviewEnabled
                  ? "Copy preview URL"
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
                  `${baseUrl}/vivd-studio/api/download/${projectSlug}/${version}`,
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md"
            onClick={handleClose}
            title="Back to projects"
          >
            <VivdIcon className="h-4 w-4" />
            <span className="sr-only">Back to projects</span>
          </Button>
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
              </BreadcrumbList>
            </Breadcrumb>
          </>
        }
        trailing={
          <>
            {projectActions}
            {actionSlot}
          </>
        }
        endAccessory={
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md"
            onClick={handleClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        }
      />
    );
  };

  if (isLoading) {
    return (
      <CenteredLoading
        message="Loading project..."
        fullScreen
        className="w-screen bg-background"
      />
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-background">
        <div className="text-destructive">
          Error loading project: {error.message}
        </div>
      </div>
    );
  }

  if (!project || !projectSlug) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  if (startStudio.error) {
    return (
      <FramedHostShell fullScreen header={renderFullscreenHeader({})}>
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
      <FramedHostShell fullScreen header={renderFullscreenHeader({})}>
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
        fullScreen
        header={renderFullscreenHeader({
          actionSlot: (
            <Button disabled size="sm" className="h-8 rounded-md px-3">
              <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
              Booting studio…
            </Button>
          ),
        })}
      >
        <div className={HOST_VIEWPORT_INSET_CLASS}>
          <FramedViewport className="bg-background/80">
            <StudioStartupLoading fullScreen className="h-full min-h-0" />
          </FramedViewport>
        </div>
      </FramedHostShell>
    );
  }

  if (!studioIframeSrc) {
    return (
      <>
        <FramedHostShell
          fullScreen
          header={renderFullscreenHeader({ includeProjectActions: true })}
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

        <PublishSiteDialog
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          slug={projectSlug}
          version={version}
          onOpenStudio={handleEdit}
        />

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
                  renameSlugInput.trim().toLowerCase() ===
                    projectSlug.toLowerCase()
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

        <AlertDialog
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
        >
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
                }}
              >
                {deleteProjectMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <div className="relative flex h-dvh w-screen flex-col bg-background">
      <div className="flex-1 min-h-0">
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
                      unresponsive. Try reloading the iframe or doing a hard
                      restart.
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
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
                <StudioStartupLoading fullScreen className="h-full min-h-0" />
              )}
            </div>
          ) : null}
        </div>
      </div>

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
