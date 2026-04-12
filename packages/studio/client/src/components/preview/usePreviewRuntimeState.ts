import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  getVivdStudioToken,
  resolveStudioRuntimePath,
  withVivdStudioTokenQuery,
} from "@/lib/studioAuth";
import { copyTextWithFallback, openUrlInNewTab } from "@/lib/browserActions";
import {
  POLLING_BACKGROUND,
  POLLING_DEV_SERVER_KEEPALIVE,
  POLLING_DEV_SERVER_STARTING,
} from "@/app/config/polling";
import { getVivdHostOrigin } from "@/lib/hostBridge";
import { type PreviewMode } from "./types";
import {
  buildPreviewUrl,
  getPreviewPathFromUrl,
  getPreviewRootUrl,
  normalizePreviewPathInput,
} from "./navigation";

interface UsePreviewRuntimeStateOptions {
  url: string | null;
  originalUrl?: string | null;
  projectSlug?: string;
  version?: number;
  publicPreviewEnabled: boolean;
  beginIframeLoading: () => void;
}

export function usePreviewRuntimeState({
  url,
  originalUrl,
  projectSlug,
  version,
  publicPreviewEnabled,
  beginIframeLoading,
}: UsePreviewRuntimeStateOptions) {
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState(version || 1);
  const [currentPreviewPath, setCurrentPreviewPath] = useState("/");
  const [iframePreviewPath, setIframePreviewPath] = useState("/");

  const { data: projectsData } = trpc.project.list.useQuery(undefined, {
    enabled: !!projectSlug,
  });
  const project = projectsData?.projects?.find((entry) => entry.slug === projectSlug);
  const versions = project?.versions || [];
  const totalVersions = project?.totalVersions || 1;
  const hasMultipleVersions = totalVersions > 1;
  const enabledPlugins = project?.enabledPlugins ?? [];
  const supportEmail = projectsData?.supportEmail ?? null;

  const { data: changesData } = trpc.project.gitHasChanges.useQuery(
    { slug: projectSlug!, version: selectedVersion },
    { enabled: !!projectSlug, refetchInterval: POLLING_BACKGROUND },
  );
  const hasGitChanges = changesData?.hasChanges || false;

  const { mutate: setCurrentVersion } =
    trpc.project.setCurrentVersion.useMutation({
      onSuccess: () => {
        utils.project.list.invalidate();
      },
    });

  useEffect(() => {
    if (version && version !== selectedVersion) {
      setSelectedVersion(version);
    }
  }, [selectedVersion, version]);

  const { data: previewInfo, isLoading: isPreviewLoading } =
    trpc.project.getPreviewInfo.useQuery(
      { slug: projectSlug!, version: selectedVersion },
      {
        enabled: !!projectSlug,
        refetchOnWindowFocus: true,
        refetchInterval: (query) => {
          const status = query.state.data?.status;
          if (status === "starting" || status === "installing") {
            return POLLING_DEV_SERVER_STARTING;
          }
          return false;
        },
      },
    );

  const shareablePreviewOrigin = useMemo(() => getVivdHostOrigin(), []);
  const { data: shareablePreviewUrl } = trpc.project.getShareablePreviewUrl.useQuery(
    {
      slug: projectSlug!,
      version: selectedVersion,
      origin: shareablePreviewOrigin,
    },
    {
      enabled: !!projectSlug,
    },
  );

  const previewMode: PreviewMode = previewInfo?.mode ?? "static";
  const devServerStatus = isPreviewLoading
    ? "starting"
    : (previewInfo?.status ?? "ready");
  const devServerError =
    previewInfo?.mode === "devserver" ? previewInfo.error : undefined;

  const { mutate: keepAliveDevServer } =
    trpc.project.keepAliveDevServer.useMutation();

  useEffect(() => {
    if (
      !projectSlug ||
      previewMode !== "devserver" ||
      devServerStatus !== "ready"
    ) {
      return;
    }

    const interval = setInterval(() => {
      keepAliveDevServer({ slug: projectSlug, version: selectedVersion });
    }, POLLING_DEV_SERVER_KEEPALIVE);

    return () => clearInterval(interval);
  }, [
    devServerStatus,
    keepAliveDevServer,
    previewMode,
    projectSlug,
    selectedVersion,
  ]);

  const livePreviewRootUrl = useMemo(() => {
    const candidate = originalUrl ?? url ?? previewInfo?.url ?? "/";
    if (!candidate) return "";
    return getPreviewRootUrl(resolveStudioRuntimePath(candidate), previewMode);
  }, [originalUrl, previewInfo?.url, previewMode, url]);

  const fallbackPublishPreviewUrl = useMemo(() => {
    if (!projectSlug) return "";
    return new URL(
      `/vivd-studio/api/preview/${projectSlug}/v${selectedVersion}/`,
      shareablePreviewOrigin,
    ).toString();
  }, [projectSlug, selectedVersion, shareablePreviewOrigin]);

  const stablePublishPreviewUrl = useMemo(() => {
    const candidate = shareablePreviewUrl?.url || fallbackPublishPreviewUrl;
    if (!candidate) return "";

    try {
      return new URL(candidate, shareablePreviewOrigin).toString();
    } catch {
      return candidate;
    }
  }, [fallbackPublishPreviewUrl, shareablePreviewOrigin, shareablePreviewUrl?.url]);

  const fullUrl = livePreviewRootUrl
    ? withVivdStudioTokenQuery(
        buildPreviewUrl(livePreviewRootUrl, iframePreviewPath),
        getVivdStudioToken(),
      )
    : "";

  const reloadCurrentPreview = useCallback(() => {
    setIframePreviewPath(currentPreviewPath);
    beginIframeLoading();
    setRefreshKey((prev) => prev + 1);
  }, [beginIframeLoading, currentPreviewPath]);

  const refreshPreview = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const navigatePreviewPath = useCallback(
    (path: string) => {
      const normalized = normalizePreviewPathInput(path);
      setCurrentPreviewPath(normalized);
      setIframePreviewPath(normalized);
      if (normalized === currentPreviewPath) {
        beginIframeLoading();
        setRefreshKey((prev) => prev + 1);
        return;
      }

      beginIframeLoading();
    },
    [beginIframeLoading, currentPreviewPath],
  );

  const handlePreviewLocationChange = useCallback(
    (href: string) => {
      if (!livePreviewRootUrl) return;
      const nextPath = getPreviewPathFromUrl(href, livePreviewRootUrl);
      setCurrentPreviewPath((prev) => (prev === nextPath ? prev : nextPath));
    },
    [livePreviewRootUrl],
  );

  useEffect(() => {
    setCurrentPreviewPath("/");
    setIframePreviewPath("/");
  }, [projectSlug]);

  const markPreviewUrlCopied = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleCopy = useCallback(() => {
    if (!publicPreviewEnabled) {
      toast.error("Preview URL is disabled for this project");
      return;
    }

    if (!stablePublishPreviewUrl) {
      toast.error("Preview URL is not ready yet");
      return;
    }

    copyTextWithFallback(stablePublishPreviewUrl)
      .then(() => {
        markPreviewUrlCopied();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error("Failed to copy preview URL", { description: message });
      });
  }, [markPreviewUrlCopied, publicPreviewEnabled, stablePublishPreviewUrl]);

  const handleOpenPreviewUrl = useCallback(() => {
    if (!publicPreviewEnabled) {
      toast.error("Preview URL is disabled for this project");
      return;
    }

    if (!stablePublishPreviewUrl) {
      toast.error("Preview URL is not ready yet");
      return;
    }

    openUrlInNewTab(stablePublishPreviewUrl);
  }, [publicPreviewEnabled, stablePublishPreviewUrl]);

  const handleVersionSelect = useCallback(
    (newVersion: number) => {
      setSelectedVersion(newVersion);
      if (projectSlug) {
        setCurrentVersion({
          slug: projectSlug,
          version: newVersion,
        });
      }
      reloadCurrentPreview();
    },
    [projectSlug, reloadCurrentPreview, setCurrentVersion],
  );

  const handleRefresh = useCallback(() => {
    reloadCurrentPreview();
    if (projectSlug) {
      utils.project.getPreviewInfo.cancel({
        slug: projectSlug,
        version: selectedVersion,
      });
      utils.project.getPreviewInfo.invalidate({
        slug: projectSlug,
        version: selectedVersion,
      });
    }
  }, [projectSlug, reloadCurrentPreview, selectedVersion, utils.project.getPreviewInfo]);

  return {
    copied,
    refreshKey,
    selectedVersion,
    currentPreviewPath,
    fullUrl,
    previewMode,
    devServerStatus,
    devServerError,
    versions,
    totalVersions,
    hasMultipleVersions,
    enabledPlugins,
    supportEmail,
    isPreviewLoading,
    hasGitChanges,
    handleVersionSelect,
    handleCopy,
    handleOpenPreviewUrl,
    handleRefresh,
    navigatePreviewPath,
    handlePreviewLocationChange,
    handleTaskComplete: reloadCurrentPreview,
    refreshPreview,
  };
}
