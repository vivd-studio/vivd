import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { ModeToggle, useTheme } from "@/components/theme";
import { HeaderProfileMenu } from "@/components/shell";
import { ROUTES } from "@/app/router";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { isColorTheme, isTheme } from "@vivd/shared/types";
import { PublishSiteDialog } from "@/components/projects/publish/PublishSiteDialog";
import { toast } from "sonner";

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

  useEffect(() => {
    setEditRequested(false);
    startStudio.reset();
  }, [projectSlug, startStudio.reset]);

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
    startStudio.mutate({ slug: projectSlug, version });
  };

  const studioBaseUrl = useMemo(() => {
    return editRequested
      ? startStudio.data?.success
        ? startStudio.data.url
        : null
      : studioUrlQuery.data?.status === "running"
        ? studioUrlQuery.data.url
        : null;
  }, [editRequested, startStudio.data, studioUrlQuery.data]);

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
      if (type === "vivd:studio:close") {
        navigate(ROUTES.DASHBOARD);
        return;
      }
      if (type === "vivd:studio:fullscreen") {
        navigate(`${ROUTES.PROJECT_STUDIO_FULLSCREEN(projectSlug!)}?version=${version}`);
        return;
      }
      if (type === "vivd:studio:theme") {
        const nextTheme = event.data?.theme;
        const nextColorTheme = event.data?.colorTheme;
        if (isTheme(nextTheme)) setTheme(nextTheme);
        if (isColorTheme(nextColorTheme)) setColorTheme(nextColorTheme);
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
    return url.toString();
  }, [projectSlug, publicPreviewEnabled, studioBaseUrl, version]);

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

  const thumbnailSrc = project?.thumbnailUrl ?? null;

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
          <Button variant="ghost" onClick={handleClose}>
            Close
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
          <Button variant="ghost" onClick={handleClose}>
            Close
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
          <Button variant="ghost" onClick={handleClose}>
            Close
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
          {previewIframeSrc ? (
            publicPreviewEnabled ? (
              <Button variant="outline" onClick={handleCopyPreviewUrl}>
                {previewUrlCopied ? "Copied!" : "Copy preview URL"}
              </Button>
            ) : (
              <Button variant="outline" disabled>
                Preview URL disabled
              </Button>
            )
          ) : null}
          <Button variant="outline" onClick={() => setPublishDialogOpen(true)}>
            Publish site
          </Button>
          <ModeToggle />
          <HeaderProfileMenu />
          <Button variant="ghost" onClick={handleClose}>
            Close
          </Button>
        </header>
      ) : null}

      <div className="flex-1 min-h-0">
        {studioIframeSrc ? (
          <iframe
            ref={studioIframeRef}
            onLoad={syncThemeToStudio}
            key={`${projectSlug}-${version}-${studioUrlQuery.data?.url ?? startStudio.data?.url ?? ""}`}
            src={studioIframeSrc}
            title={`Vivd Studio - ${projectSlug}`}
            className="h-full w-full border-0"
            allow="fullscreen; clipboard-write"
            allowFullScreen
          />
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
    </div>
  );
}
