import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router";

/**
 * Fullscreen studio view (still embedded via iframe).
 * Used to show the studio without the app layout chrome, but stays in the same tab.
 */
export default function StudioFullscreen() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();
  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const currentVersion = project?.currentVersion || 1;
  const urlParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
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
  const studioUrlQuery = trpc.project.getStudioUrl.useQuery(
    { slug: projectSlug!, version },
    {
      enabled: !!projectSlug && !!project,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
    },
  );

  // If the studio isn't already running, start it automatically in fullscreen mode.
  useEffect(() => {
    if (!projectSlug || !project) return;
    if (studioUrlQuery.data?.status === "running") return;
    if (startStudio.isPending || startStudio.data) return;
    startStudio.mutate({ slug: projectSlug, version });
  }, [
    project,
    projectSlug,
    startStudio,
    startStudio.data,
    startStudio.isPending,
    studioUrlQuery.data?.status,
    version,
  ]);

  const baseUrl = useMemo(() => {
    if (studioUrlQuery.data?.status === "running") return studioUrlQuery.data.url;
    if (startStudio.data?.success) return startStudio.data.url;
    return null;
  }, [startStudio.data, studioUrlQuery.data]);

  const studioOrigin = useMemo(() => {
    if (!baseUrl) return null;
    try {
      return new URL(baseUrl).origin;
    } catch {
      return null;
    }
  }, [baseUrl]);

  // Handle close/minimize requests from the studio iframe.
  useEffect(() => {
    if (!studioOrigin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== studioOrigin) return;
      const type = event.data?.type;
      if (type === "vivd:studio:close" || type === "vivd:studio:exitFullscreen") {
        navigate(`${ROUTES.PROJECT(projectSlug!)}?view=studio&version=${version}`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate, projectSlug, studioOrigin, version]);

  const studioIframeSrc = useMemo(() => {
    if (!baseUrl) return null;
    const url = new URL("/vivd-studio", baseUrl);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("fullscreen", "1");
    url.searchParams.set("projectSlug", projectSlug || "");
    url.searchParams.set("version", String(version));
    url.searchParams.set(
      "returnTo",
      new URL(
        `${ROUTES.PROJECT(projectSlug || "")}?view=studio&version=${version}`,
        window.location.origin,
      ).toString(),
    );
    return url.toString();
  }, [baseUrl, projectSlug, version]);

  if (isLoading) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center">
        <div className="text-destructive">Error loading project: {error.message}</div>
      </div>
    );
  }

  if (!project || !projectSlug) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  if (startStudio.data && !startStudio.data.success) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center">
        <div className="text-destructive">
          Failed to start studio: {startStudio.data.error || "Unknown error"}
        </div>
      </div>
    );
  }

  if (!studioIframeSrc) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center">
        <div className="text-muted-foreground">Starting studio…</div>
      </div>
    );
  }

  return (
    <div className="h-dvh w-screen">
      <iframe
        src={studioIframeSrc}
        title={`Vivd Studio - ${projectSlug}`}
        className="h-full w-full border-0"
        allow="fullscreen; clipboard-write"
        allowFullScreen
      />
    </div>
  );
}
