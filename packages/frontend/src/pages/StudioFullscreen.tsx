import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { ROUTES } from "@/app/router";
import { CenteredLoading, VivdIcon } from "@/components/common";
import { StudioRecoveryOverlay } from "@/components/common/StudioRecoveryOverlay";
import { StudioStartupLoading } from "@/components/common/StudioStartupLoading";
import { StudioBootstrapIframe } from "@/components/common/StudioBootstrapIframe";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useTheme } from "@/components/theme";
import { HeaderBreadcrumbTextLink, HostHeader } from "@/components/shell";
import {
  type StudioRuntimeSession,
  useStudioHostRuntime,
} from "@/hooks/useStudioHostRuntime";
import { useStudioIframeLifecycle } from "@/hooks/useStudioIframeLifecycle";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import { createStudioRuntimeSession } from "@/lib/studioRuntimeSession";
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

  const { data: projectsData, isLoading, error } = trpc.project.list.useQuery();
  const project = projectsData?.projects?.find((p) => p.slug === projectSlug);
  const currentVersion = project?.currentVersion || 1;
  const urlParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const versionOverrideRaw = urlParams.get("version");
  const initialGenerationRequested = urlParams.get("initialGeneration") === "1";
  const requestedInitialSessionId = urlParams.get("sessionId")?.trim() || null;
  const versionOverride = versionOverrideRaw
    ? Number.parseInt(versionOverrideRaw, 10)
    : NaN;
  const version =
    Number.isFinite(versionOverride) && versionOverride > 0
      ? versionOverride
      : currentVersion;
  const canBootstrapStudio = Boolean(project || initialGenerationRequested);

  const initialGenerationStatusQuery = trpc.project.status.useQuery(
    { slug: projectSlug!, version },
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
  const studioReturnPath = useMemo(() => {
    if (!projectSlug) return ROUTES.DASHBOARD;

    const params = new URLSearchParams({
      view: "studio",
      version: String(version),
      ...(initialGenerationRequested ? { initialGeneration: "1" } : {}),
    });
    if (resolvedInitialSessionId) {
      params.set("sessionId", resolvedInitialSessionId);
    }
    return `${ROUTES.PROJECT(projectSlug)}?${params.toString()}`;
  }, [initialGenerationRequested, projectSlug, resolvedInitialSessionId, version]);

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
      enabled: !!projectSlug && canBootstrapStudio,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: "always",
    },
  );

  const queryStudioRuntime = useMemo<StudioRuntimeSession | null>(() => {
    if (studioUrlQuery.data?.status !== "running") return null;
    return createStudioRuntimeSession(studioUrlQuery.data);
  }, [studioUrlQuery.data]);

  const startedStudioRuntime = useMemo<StudioRuntimeSession | null>(() => {
    if (!startStudio.data?.success) return null;
    return createStudioRuntimeSession(startStudio.data);
  }, [startStudio.data]);

  const preferredStudioRuntime = useMemo(
    () => queryStudioRuntime ?? startedStudioRuntime,
    [queryStudioRuntime, startedStudioRuntime],
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
      console.warn("[StudioFullscreen] Failed to wake studio runtime:", message);
    },
  });

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
    navigate(`${ROUTES.PROJECT_STUDIO_FULLSCREEN(projectSlug)}?${params.toString()}`, {
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

  // If the studio isn't already running, start it automatically in fullscreen mode.
  useEffect(() => {
    if (!projectSlug || !canBootstrapStudio) return;
    if (studioUrlQuery.data?.status === "running") return;
    if (startStudio.isPending || startStudio.data) return;
    if (hardRestartStudio.isPending) return;
    startStudio.mutate({ slug: projectSlug, version });
  }, [
    canBootstrapStudio,
    projectSlug,
    startStudio,
    startStudio.data,
    startStudio.isPending,
    hardRestartStudio.isPending,
    studioUrlQuery.data?.status,
    version,
  ]);

  useEffect(() => {
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

    clearRuntimeOverride();

    const result = await hardRestartStudio.mutateAsync({
      slug: projectSlug,
      version: targetVersion,
    });
    if (!result.success) {
      // Fullscreen view doesn't show app chrome; keep failures minimal.
      console.error("[StudioFullscreen] Failed to restart studio:", result.error);
      return;
    }

    replaceRuntime(createStudioRuntimeSession(result), { reload: true });
  };

  const renderLoadingHeader = (studioStatusLabel: string) => (
    <HostHeader
      leadingAccessory={
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-md"
          onClick={() => navigate(studioReturnPath)}
          title="Back to project"
        >
          <VivdIcon className="h-4 w-4" />
          <span className="sr-only">Back to project</span>
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
                <HeaderBreadcrumbTextLink to={studioReturnPath}>
                  Projects
                </HeaderBreadcrumbTextLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{projectSlug}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <span className="text-sm text-muted-foreground">
                  {studioStatusLabel}
                </span>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </>
      }
    />
  );

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
    theme,
    colorTheme,
    setTheme,
    setColorTheme,
    onClose: () => {
      navigate(studioReturnPath);
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
    url.searchParams.set("fullscreen", "1");
    url.searchParams.set("projectSlug", projectSlug || "");
    url.searchParams.set("version", String(version));
    if (initialGenerationRequested) {
      url.searchParams.set("initialGeneration", "1");
    }
    if (resolvedInitialSessionId) {
      url.searchParams.set("sessionId", resolvedInitialSessionId);
    }
    url.searchParams.set("hostOrigin", window.location.origin);
    const returnToParams = new URLSearchParams({
      view: "studio",
      version: String(version),
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
    resolvedInitialSessionId,
    studioBaseUrl,
    version,
  ]);

  const studioIframeTarget = useMemo(
    () => `vivd-studio-fullscreen-${projectSlug || "project"}-v${version}`,
    [projectSlug, version],
  );

  const studioIframeRequestKey = `${projectSlug}-${version}-${studioBaseUrl ?? ""}-${studioReloadNonce}`;

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

  if (!projectSlug) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  if (!project && initialGenerationRequested) {
    return (
      <StudioStartupLoading
        fullScreen
        header={renderLoadingHeader("Starting studio...")}
      />
    );
  }

  if (!project) {
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
      <StudioStartupLoading
        fullScreen
        header={renderLoadingHeader(
          hardRestartStudio.isPending ? "Restarting studio..." : "Starting studio...",
        )}
      />
    );
  }

  return (
    <div className="relative h-dvh w-screen bg-background">
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
            <StudioStartupLoading
              className="h-full min-h-0"
              header={renderLoadingHeader(
                hardRestartStudio.isPending ? "Restarting studio..." : "Starting studio...",
              )}
            />
          )}
        </div>
      ) : null}

      {isStudioRecovering && studioReady ? <StudioRecoveryOverlay /> : null}
    </div>
  );
}
