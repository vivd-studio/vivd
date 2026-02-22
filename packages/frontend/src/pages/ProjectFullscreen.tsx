import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { Button } from "@/components/ui/button";
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
import { ModeToggle, useTheme } from "@/components/theme";
import { HeaderProfileMenu } from "@/components/shell";
import { ROUTES } from "@/app/router";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { isColorTheme, isTheme } from "@vivd/shared/types";
import { PublishSiteDialog } from "@/components/projects/publish/PublishSiteDialog";
import { authClient } from "@/lib/auth-client";
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
  const [studioUrlOverride, setStudioUrlOverride] = useState<string | null>(null);
  const [studioAccessTokenOverride, setStudioAccessTokenOverride] = useState<string | null>(null);
  const [studioReloadNonce, setStudioReloadNonce] = useState(0);
  const [studioReady, setStudioReady] = useState(false);
  const [studioLoadTimedOut, setStudioLoadTimedOut] = useState(false);
  const [studioLoadErrored, setStudioLoadErrored] = useState(false);
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { data: session } = authClient.useSession();
  const { data: membership } = trpc.organization.getMyMembership.useQuery(
    undefined,
    { enabled: !!session },
  );
  const canManagePreview = membership?.organizationRole !== "client_editor";

  useEffect(() => {
    setEditRequested(false);
    startStudio.reset();
    hardRestartStudio.reset();
    setStudioUrlOverride(null);
    setStudioAccessTokenOverride(null);
    setStudioReloadNonce(0);
  }, [projectSlug, startStudio.reset, hardRestartStudio.reset]);

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
    setEditRequested(true);
    setStudioUrlOverride(null);
    setStudioAccessTokenOverride(null);
    startStudio.mutate({ slug: projectSlug, version });
  };

  const handleHardRestart = async (requestedVersion?: number) => {
    if (!projectSlug || !project) return;

    const targetVersion =
      typeof requestedVersion === "number" &&
      Number.isFinite(requestedVersion) &&
      requestedVersion > 0
        ? requestedVersion
        : version;

    setEditRequested(true);
    setStudioUrlOverride(null);
    setStudioAccessTokenOverride(null);

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

      setStudioUrlOverride(result.url);
      setStudioAccessTokenOverride(result.accessToken);
      setStudioReloadNonce((n) => n + 1);
      toast.success("Studio restarted");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to restart studio", { description: message });
    }
  };

  const studioBaseUrl = useMemo(() => {
    if (hardRestartStudio.isPending) return null;
    if (studioUrlOverride) return studioUrlOverride;
    return editRequested
      ? startStudio.data?.success
        ? startStudio.data.url
        : null
      : studioUrlQuery.data?.status === "running"
        ? studioUrlQuery.data.url
        : null;
  }, [
    editRequested,
    hardRestartStudio.isPending,
    startStudio.data,
    studioUrlOverride,
    studioUrlQuery.data,
  ]);

  const studioAccessToken = useMemo(() => {
    if (hardRestartStudio.isPending) return null;
    if (studioAccessTokenOverride) return studioAccessTokenOverride;
    return editRequested
      ? startStudio.data?.success
        ? startStudio.data.accessToken
        : null
      : studioUrlQuery.data?.status === "running"
        ? studioUrlQuery.data.accessToken
        : null;
  }, [
    editRequested,
    hardRestartStudio.isPending,
    startStudio.data,
    studioAccessTokenOverride,
    studioUrlQuery.data,
  ]);

  useEffect(() => {
    if (!projectSlug || !studioBaseUrl) return;

    const heartbeat = () => {
      touchStudio.mutate({ slug: projectSlug, version });
      const healthUrl = new URL("/health", studioBaseUrl).toString();
      void fetch(healthUrl, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
      }).catch(() => {
        // Keepalive is best-effort.
      });
    };

    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [projectSlug, studioBaseUrl, touchStudio.mutate, version]);

  const syncThemeToStudio = () => {
    const targetWindow = studioIframeRef.current?.contentWindow;
    if (!targetWindow) return;
    targetWindow.postMessage(
      { type: "vivd:host:theme", theme, colorTheme },
      "*",
    );
  };

  useEffect(() => {
    syncThemeToStudio();
  }, [theme, colorTheme]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const studioWindow = studioIframeRef.current?.contentWindow;
      if (!studioWindow || event.source !== studioWindow) return;
      const type = event.data?.type;
      if (type === "vivd:studio:ready") {
        setStudioReady(true);
        syncThemeToStudio();
        return;
      }
      if (type === "vivd:studio:close") {
        navigate(ROUTES.DASHBOARD);
        return;
      }
      if (type === "vivd:studio:fullscreen") {
        navigate(`${ROUTES.PROJECT_STUDIO_FULLSCREEN(projectSlug!)}?version=${version}`);
        return;
      }
      if (type === "vivd:studio:navigate") {
        const path = event.data?.path;
        if (typeof path === "string" && path.startsWith("/")) {
          navigate(path);
          return;
        }
      }
      if (type === "vivd:studio:theme") {
        setStudioReady(true);
        const nextTheme = event.data?.theme;
        const nextColorTheme = event.data?.colorTheme;
        if (isTheme(nextTheme)) setTheme(nextTheme);
        if (isColorTheme(nextColorTheme)) setColorTheme(nextColorTheme);
      }
      if (type === "vivd:studio:hardRestart") {
        const versionRaw = event.data?.version;
        const versionFromMessage =
          typeof versionRaw === "number" ? versionRaw : Number.NaN;
        void handleHardRestart(
          Number.isFinite(versionFromMessage) ? versionFromMessage : undefined,
        );
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate, projectSlug, setColorTheme, setTheme, version]);

  const studioIframeSrc = useMemo(() => {
    if (!studioBaseUrl) return null;
    const url = new URL("/vivd-studio", studioBaseUrl);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("projectSlug", projectSlug || "");
    url.searchParams.set("version", String(version));
    url.searchParams.set("publicPreviewEnabled", publicPreviewEnabled ? "1" : "0");
    url.searchParams.set(
      "returnTo",
      new URL(ROUTES.PROJECT_FULLSCREEN(projectSlug || ""), window.location.origin).toString(),
    );

    if (studioAccessToken) {
      const hashParams = new URLSearchParams();
      hashParams.set("vivdStudioToken", studioAccessToken);
      url.hash = hashParams.toString();
    }
    return url.toString();
  }, [projectSlug, publicPreviewEnabled, studioAccessToken, studioBaseUrl, version]);

  useEffect(() => {
    if (!studioIframeSrc) {
      setStudioReady(false);
      setStudioLoadTimedOut(false);
      setStudioLoadErrored(false);
      return;
    }

    setStudioReady(false);
    setStudioLoadTimedOut(false);
    setStudioLoadErrored(false);

    const timeout = window.setTimeout(() => {
      setStudioLoadTimedOut(true);
    }, 25_000);

    return () => window.clearTimeout(timeout);
  }, [studioIframeSrc, studioReloadNonce]);

  const previewIframeSrc = useMemo(() => {
    if (!projectSlug || !project) return null;
    if (externalPreview?.status !== "ready") return null;
    return externalPreview.url;
  }, [externalPreview, projectSlug, project]);

  const handleCopyPreviewUrl = () => {
    if (!externalPreview || externalPreview.status !== "ready") return;
    const absoluteUrl = new URL(externalPreview.url, window.location.origin).toString();

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
    if (!projectSlug) return;
    regenerateThumbnailMutation.mutate({ slug: projectSlug, version });
  };

  const thumbnailSrc = project?.thumbnailUrl ?? null;
  const selectedVersionInfo = project?.versions?.find((v) => v.version === version);
  const isSelectedVersionCompleted =
    selectedVersionInfo?.status === "completed" ||
    (version === project?.currentVersion && project?.status === "completed");

  if (isLoading) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading project…</div>
      </div>
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
      <div className="flex h-dvh w-screen flex-col bg-background">
        <header className="px-3 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <Link
            to={ROUTES.DASHBOARD}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Projects
          </Link>
          <div className="flex-1 text-sm font-medium truncate">{projectSlug}</div>
          <ModeToggle />
          <HeaderProfileMenu />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <div className="text-destructive">
            Error starting studio: {startStudio.error.message}
          </div>
        </div>
      </div>
    );
  }

  if (startStudio.data && !startStudio.data.success) {
    return (
      <div className="flex h-dvh w-screen flex-col bg-background">
        <header className="px-3 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <Link
            to={ROUTES.DASHBOARD}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Projects
          </Link>
          <div className="flex-1 text-sm font-medium truncate">{projectSlug}</div>
          <ModeToggle />
          <HeaderProfileMenu />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3">
          <div className="text-destructive">
            Failed to start studio: {startStudio.data.error || "Unknown error"}
          </div>
          <Button onClick={handleEdit}>Retry</Button>
        </div>
      </div>
    );
  }

  if (editRequested && !studioIframeSrc) {
    return (
      <div className="flex h-dvh w-screen flex-col bg-background">
        <header className="px-3 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <Link
            to={ROUTES.DASHBOARD}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Projects
          </Link>
          <div className="flex-1 text-sm font-medium truncate">{projectSlug}</div>
          <Button disabled>
            <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
            Booting studio…
          </Button>
          <ModeToggle />
          <HeaderProfileMenu />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <StudioStartupLoading fullScreen />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-screen flex-col bg-background">
      {!studioIframeSrc ? (
        <header className="px-3 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <Link
            to={ROUTES.DASHBOARD}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Projects
          </Link>
          <div className="flex-1 text-sm font-medium truncate">{projectSlug}</div>
          {!editRequested ? <Button onClick={handleEdit}>Edit</Button> : null}
          <Button variant="outline" onClick={() => setPublishDialogOpen(true)}>
            Publish
          </Button>
          {analyticsAvailable ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => analyticsPath && navigate(analyticsPath)}
              title="Analytics"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Actions should stay in sync — see PROJECT_ACTIONS in @vivd/shared */}
              <DropdownMenuItem
                onClick={handleCopyPreviewUrl}
                disabled={!previewIframeSrc || !publicPreviewEnabled}
              >
                <Copy className="h-4 w-4 mr-2" />
                {previewUrlCopied
                  ? "Copied!"
                  : publicPreviewEnabled
                    ? "Copy preview URL"
                    : "Preview URL disabled"}
              </DropdownMenuItem>
              {canManagePreview && (
                <DropdownMenuItem
                  onClick={() => {
                    if (!projectSlug) return;
                    setPublicPreviewEnabledMutation.mutate({
                      slug: projectSlug,
                      enabled: !publicPreviewEnabled,
                    });
                  }}
                  disabled={setPublicPreviewEnabledMutation.isPending}
                >
                  {publicPreviewEnabled ? (
                    <EyeOff className="h-4 w-4 mr-2" />
                  ) : (
                    <Eye className="h-4 w-4 mr-2" />
                  )}
                  {publicPreviewEnabled
                    ? "Disable preview URL"
                    : "Enable preview URL"}
                </DropdownMenuItem>
              )}
              {project?.url && (
                <DropdownMenuItem
                  onClick={() => window.open(project.url, "_blank")}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Original website
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  if (!projectSlug) return;
                  const baseUrl = import.meta.env.VITE_BACKEND_URL || "";
                  window.open(
                    `${baseUrl}/vivd-studio/api/download/${projectSlug}/${version}`,
                    "_blank",
                  );
                }}
                disabled={!isSelectedVersionCompleted}
              >
                <Download className="h-4 w-4 mr-2" />
                Download as ZIP
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleRegenerateThumbnail}
                disabled={
                  !isSelectedVersionCompleted ||
                  regenerateThumbnailMutation.isPending
                }
              >
                {regenerateThumbnailMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Image className="h-4 w-4 mr-2" />
                )}
                {regenerateThumbnailMutation.isPending
                  ? "Regenerating thumbnail..."
                  : "Regenerate thumbnail"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate(ROUTES.PROJECT_PLUGINS(projectSlug))}
              >
                <Plug className="h-4 w-4 mr-2" />
                Plugins
              </DropdownMenuItem>
              {analyticsAvailable ? (
                <DropdownMenuItem
                  onClick={() => analyticsPath && navigate(analyticsPath)}
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Analytics
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ModeToggle />
          <HeaderProfileMenu />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
      ) : null}

      <div className="flex-1 min-h-0">
        {studioIframeSrc ? (
          <div className="relative h-full w-full">
            <iframe
              ref={studioIframeRef}
              onLoad={syncThemeToStudio}
              onError={() => setStudioLoadErrored(true)}
              key={`${projectSlug}-${version}-${studioBaseUrl ?? ""}-${studioReloadNonce}`}
              src={studioIframeSrc}
              title={`Vivd Studio - ${projectSlug}`}
              className="h-full w-full border-0"
              allow="fullscreen; clipboard-write"
              allowFullScreen
            />

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
                          onClick={() => setStudioReloadNonce((n) => n + 1)}
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
        ) : previewIframeSrc ? (
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
                Preview not ready yet
                {externalPreview?.status ? ` (${externalPreview.status})` : ""}. Click{" "}
                <span className="font-medium text-foreground">Edit</span> to start a studio
                machine.
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
      </div>

      {!studioIframeSrc ? (
        <PublishSiteDialog
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          slug={projectSlug}
          version={version}
          onOpenStudio={handleEdit}
        />
      ) : null}

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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
    </div>
  );
}
