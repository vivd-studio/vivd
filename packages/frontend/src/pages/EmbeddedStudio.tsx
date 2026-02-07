import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDocumentTitle } from "@/lib/brand";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ModeToggle, useTheme } from "@/components/theme";
import { HeaderProfileMenu } from "@/components/shell";
import { ROUTES } from "@/app/router";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { isColorTheme, isTheme } from "@vivd/shared/types";

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
  const [editRequested, setEditRequested] = useState(false);
  const studioIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Fetch project data to get current version
  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();

  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const version = project?.currentVersion || 1;

  const urlParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const resumeStudio = urlParams.get("view") === "studio";
  const versionOverrideRaw = urlParams.get("version");
  const versionOverride = versionOverrideRaw
    ? Number.parseInt(versionOverrideRaw, 10)
    : NaN;
  const studioVersion =
    Number.isFinite(versionOverride) && versionOverride > 0 ? versionOverride : version;

  const utils = trpc.useUtils();
  const startStudio = trpc.project.startStudio.useMutation({
    onSuccess: () => {
      if (!projectSlug) return;
      utils.project.getStudioUrl.invalidate({ slug: projectSlug, version: studioVersion });
    },
  });
  const touchStudio = trpc.project.touchStudio.useMutation();
  const studioUrlQuery = trpc.project.getStudioUrl.useQuery(
    { slug: projectSlug!, version: studioVersion },
    {
      enabled: !!projectSlug && !!project,
      // This is a lightweight status check; prefer correctness over caching so we can
      // resume an already-running studio after navigation (or after fullscreen toggles).
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
    },
  );
  const { data: externalPreview } = trpc.project.getExternalPreviewStatus.useQuery(
    { slug: projectSlug!, version: studioVersion },
    { enabled: !!projectSlug && !!project },
  );

  // Reset local state when navigating between projects.
  useEffect(() => {
    setEditRequested(false);
    startStudio.reset();
  }, [projectSlug, startStudio.reset]);

  // If we navigated back from fullscreen with `?view=studio`, prefer showing the running studio.
  useEffect(() => {
    if (resumeStudio) {
      setEditRequested(false);
    }
  }, [resumeStudio]);

  // Set document title to project name
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
    startStudio.mutate({ slug: projectSlug, version: studioVersion });
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
      touchStudio.mutate({ slug: projectSlug, version: studioVersion });
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
  }, [projectSlug, studioBaseUrl, studioVersion, touchStudio.mutate]);

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

  // Listen for studio events from the iframe (cross-origin via postMessage).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const studioWindow = studioIframeRef.current?.contentWindow;
      if (!studioWindow || event.source !== studioWindow) return;
      if (event.data?.type === "vivd:studio:close") {
        navigate(ROUTES.DASHBOARD);
      }
      if (event.data?.type === "vivd:studio:fullscreen") {
        navigate(`${ROUTES.PROJECT_STUDIO_FULLSCREEN(projectSlug!)}?version=${studioVersion}`);
      }
      if (event.data?.type === "vivd:studio:theme") {
        const nextTheme = event.data?.theme;
        const nextColorTheme = event.data?.colorTheme;

        if (isTheme(nextTheme)) setTheme(nextTheme);
        if (isColorTheme(nextColorTheme)) setColorTheme(nextColorTheme);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [
    navigate,
    projectSlug,
    setColorTheme,
    setTheme,
    studioVersion,
  ]);

  const studioIframeSrc = useMemo(() => {
    if (!studioBaseUrl) return null;

    const url = new URL("/vivd-studio", studioBaseUrl);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("projectSlug", projectSlug || "");
    url.searchParams.set("version", String(studioVersion));
    // Used by the "fullscreen/open in new tab" studio view to navigate back.
    url.searchParams.set(
      "returnTo",
      new URL(
        `${ROUTES.PROJECT(projectSlug || "")}?view=studio&version=${studioVersion}`,
        window.location.origin,
      ).toString(),
    );
    return url.toString();
  }, [projectSlug, studioBaseUrl, studioVersion]);

  const previewIframeSrc = useMemo(() => {
    if (!projectSlug || !project) return null;
    if (externalPreview?.status !== "ready") return null;
    return externalPreview.url;
  }, [externalPreview, projectSlug, project]);

  const thumbnailSrc = useMemo(() => {
    if (!projectSlug) return null;
    return `/vivd-studio/api/projects/${projectSlug}/v${version}/.vivd/thumbnail.webp`;
  }, [projectSlug, version]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading project...</div>
      </div>
    );
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

  if (!project || !projectSlug) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  if (startStudio.error) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4 hidden sm:block" />
          <Breadcrumb className="hidden sm:flex">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={ROUTES.DASHBOARD}>Projects</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex-1" />
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
      <div className="flex h-full min-h-0 flex-col">
        <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4 hidden sm:block" />
          <Breadcrumb className="hidden sm:flex">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={ROUTES.DASHBOARD}>Projects</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex-1" />
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
      <div className="flex h-full min-h-0 flex-col">
        <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4 hidden sm:block" />
          <Breadcrumb className="hidden sm:flex">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={ROUTES.DASHBOARD}>Projects</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex-1" />
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
        <StudioStartupLoading />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!studioIframeSrc ? (
        <header className="px-2 md:px-4 py-2.5 border-b flex flex-row items-center gap-2 shrink-0 bg-background">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4 hidden sm:block" />
          <Breadcrumb className="hidden sm:flex">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={ROUTES.DASHBOARD}>Projects</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex-1" />
          {!editRequested ? <Button onClick={handleEdit}>Edit</Button> : null}
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
                Preview not ready yet{externalPreview?.status ? ` (${externalPreview.status})` : ""}. Click{" "}
                <span className="font-medium text-foreground">Edit</span> to start a studio machine.
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
    </div>
  );
}
