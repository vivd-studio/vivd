import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { CenteredLoading } from "@/components/common";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme";
import { isColorTheme, isTheme } from "@vivd/shared/types";
import { Loader2 } from "lucide-react";

/**
 * Fullscreen studio view (still embedded via iframe).
 * Used to show the studio without the app layout chrome, but stays in the same tab.
 */
export default function StudioFullscreen() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, colorTheme, setTheme, setColorTheme } = useTheme();
  const studioIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [studioUrlOverride, setStudioUrlOverride] = useState<string | null>(null);
  const [studioAccessTokenOverride, setStudioAccessTokenOverride] = useState<string | null>(null);
  const [studioReloadNonce, setStudioReloadNonce] = useState(0);
  const [studioReady, setStudioReady] = useState(false);
  const [studioLoadTimedOut, setStudioLoadTimedOut] = useState(false);
  const [studioLoadErrored, setStudioLoadErrored] = useState(false);

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

  // If the studio isn't already running, start it automatically in fullscreen mode.
  useEffect(() => {
    if (!projectSlug || !project) return;
    if (studioUrlQuery.data?.status === "running") return;
    if (startStudio.isPending || startStudio.data) return;
    if (hardRestartStudio.isPending) return;
    startStudio.mutate({ slug: projectSlug, version });
  }, [
    project,
    projectSlug,
    startStudio,
    startStudio.data,
    startStudio.isPending,
    hardRestartStudio.isPending,
    studioUrlQuery.data?.status,
    version,
  ]);

  useEffect(() => {
    setStudioUrlOverride(null);
    setStudioAccessTokenOverride(null);
    setStudioReloadNonce(0);
    hardRestartStudio.reset();
  }, [projectSlug, hardRestartStudio.reset]);

  const handleHardRestart = async (requestedVersion?: number) => {
    if (!projectSlug || !project) return;

    const targetVersion =
      typeof requestedVersion === "number" &&
      Number.isFinite(requestedVersion) &&
      requestedVersion > 0
        ? requestedVersion
        : version;

    setStudioUrlOverride(null);
    setStudioAccessTokenOverride(null);

    const result = await hardRestartStudio.mutateAsync({
      slug: projectSlug,
      version: targetVersion,
    });
    if (!result.success) {
      // Fullscreen view doesn't show app chrome; keep failures minimal.
      console.error("[StudioFullscreen] Failed to restart studio:", result.error);
      return;
    }

    setStudioUrlOverride(result.url);
    setStudioAccessTokenOverride(result.accessToken);
    setStudioReloadNonce((n) => n + 1);
  };

  const baseUrl = useMemo(() => {
    if (hardRestartStudio.isPending) return null;
    if (studioUrlOverride) return studioUrlOverride;
    if (studioUrlQuery.data?.status === "running") return studioUrlQuery.data.url;
    if (startStudio.data?.success) return startStudio.data.url;
    return null;
  }, [
    hardRestartStudio.isPending,
    startStudio.data,
    studioUrlOverride,
    studioUrlQuery.data,
  ]);

  const studioAccessToken = useMemo(() => {
    if (hardRestartStudio.isPending) return null;
    if (studioAccessTokenOverride) return studioAccessTokenOverride;
    if (studioUrlQuery.data?.status === "running") return studioUrlQuery.data.accessToken;
    if (startStudio.data?.success) return startStudio.data.accessToken;
    return null;
  }, [
    hardRestartStudio.isPending,
    startStudio.data,
    studioAccessTokenOverride,
    studioUrlQuery.data,
  ]);

  useEffect(() => {
    if (!projectSlug || !baseUrl) return;

    const heartbeat = () => {
      touchStudio.mutate({ slug: projectSlug, version });
      const healthUrl = new URL("/health", baseUrl).toString();
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
  }, [baseUrl, projectSlug, touchStudio.mutate, version]);

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

  // Handle close/minimize requests from the studio iframe.
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
      if (type === "vivd:studio:close" || type === "vivd:studio:exitFullscreen") {
        navigate(`${ROUTES.PROJECT(projectSlug!)}?view=studio&version=${version}`);
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
  }, [
    navigate,
    projectSlug,
    setColorTheme,
    setTheme,
    version,
  ]);

  const studioIframeSrc = useMemo(() => {
    if (!baseUrl) return null;
    const url = new URL("/vivd-studio", baseUrl);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("fullscreen", "1");
    url.searchParams.set("projectSlug", projectSlug || "");
    url.searchParams.set("version", String(version));
    url.searchParams.set("hostOrigin", window.location.origin);
    url.searchParams.set(
      "returnTo",
      new URL(
        `${ROUTES.PROJECT(projectSlug || "")}?view=studio&version=${version}`,
        window.location.origin,
      ).toString(),
    );

    if (studioAccessToken) {
      const hashParams = new URLSearchParams();
      hashParams.set("vivdStudioToken", studioAccessToken);
      url.hash = hashParams.toString();
    }
    return url.toString();
  }, [baseUrl, projectSlug, studioAccessToken, version]);

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

  if (isLoading) {
    return <CenteredLoading fullScreen className="w-screen" />;
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
      <StudioStartupLoading fullScreen />
    );
  }

  return (
    <div className="relative h-dvh w-screen bg-background">
      <iframe
        ref={studioIframeRef}
        onLoad={syncThemeToStudio}
        onError={() => setStudioLoadErrored(true)}
        key={`${projectSlug}-${version}-${baseUrl ?? ""}-${studioReloadNonce}`}
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
                  unresponsive. Try reloading the iframe or doing a hard restart.
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
            <StudioStartupLoading fullScreen />
          )}
        </div>
      ) : null}
    </div>
  );
}
