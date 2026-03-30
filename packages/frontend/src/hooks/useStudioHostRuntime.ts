import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import { useStudioRuntimeGuard } from "./useStudioRuntimeGuard";

export type StudioRuntimeSession = {
  url: string;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
  bootstrapToken: string | null;
  userActionToken?: string | null;
};

type EnsureStudioRunningResult =
  | {
      success: true;
      url: string;
      runtimeUrl?: string | null;
      compatibilityUrl?: string | null;
      bootstrapToken: string | null;
      userActionToken?: string | null;
    }
  | {
      success: false;
      error?: string;
    };

type UseStudioHostRuntimeOptions = {
  resetKey: string;
  runtime: StudioRuntimeSession | null;
  suspendRuntime?: boolean;
  refreshRuntime: () => Promise<StudioRuntimeSession | null>;
  touchStudio: () => void;
  ensureStudioRunning: () => Promise<EnsureStudioRunningResult>;
  invalidateRuntime?: () => void | Promise<void>;
  onRecoveryError?: (message: string) => void;
};

type ReplaceRuntimeOptions = {
  reload?: boolean;
};

function isDefaultPort(protocol: string, port: string): boolean {
  return (
    (protocol === "https:" && (port === "" || port === "443")) ||
    (protocol === "http:" && (port === "" || port === "80"))
  );
}

export function selectBrowserStudioBaseUrl(
  runtime: StudioRuntimeSession | null,
  currentOrigin: string | null = typeof window === "undefined"
    ? null
    : window.location.origin,
): string | null {
  const directRuntimeUrl = runtime?.runtimeUrl ?? runtime?.url ?? null;
  const compatibilityUrl = runtime?.compatibilityUrl ?? null;

  if (!directRuntimeUrl) return compatibilityUrl;
  if (!compatibilityUrl || !currentOrigin) return directRuntimeUrl;

  let runtimeUrl: URL;
  let currentUrl: URL;
  try {
    runtimeUrl = new URL(directRuntimeUrl, currentOrigin);
    currentUrl = new URL(currentOrigin);
  } catch {
    return directRuntimeUrl;
  }

  const runtimeUsesNonDefaultPort = !isDefaultPort(
    runtimeUrl.protocol,
    runtimeUrl.port,
  );

  // HTTPS control-plane pages cannot safely use a direct Docker runtime
  // on a non-default port. Prefer the path-mounted compatibility route.
  if (
    currentUrl.protocol === "https:" &&
    (runtimeUrl.protocol !== "https:" || runtimeUsesNonDefaultPort)
  ) {
    return compatibilityUrl;
  }

  return directRuntimeUrl;
}

export function useStudioHostRuntime({
  resetKey,
  runtime,
  suspendRuntime = false,
  refreshRuntime,
  touchStudio,
  ensureStudioRunning,
  invalidateRuntime,
  onRecoveryError,
}: UseStudioHostRuntimeOptions) {
  const [runtimeOverride, setRuntimeOverride] = useState<StudioRuntimeSession | null>(
    null,
  );
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setRuntimeOverride(null);
    setReloadNonce(0);
  }, [resetKey]);

  const studioRuntime = useMemo(() => {
    if (suspendRuntime) return null;
    return runtimeOverride ?? runtime;
  }, [runtime, runtimeOverride, suspendRuntime]);

  const replaceRuntime = useCallback(
    (
      nextRuntime: StudioRuntimeSession | null,
      options: ReplaceRuntimeOptions = {},
    ) => {
      setRuntimeOverride(nextRuntime);
      if (options.reload) {
        setReloadNonce((nonce) => nonce + 1);
      }
    },
    [],
  );

  const clearRuntimeOverride = useCallback(() => {
    setRuntimeOverride(null);
  }, []);

  const reloadStudioIframe = useCallback(async () => {
    try {
      const nextRuntime = await refreshRuntime();
      if (nextRuntime) {
        setRuntimeOverride(nextRuntime);
      }
    } catch {
      // Fall back to the latest runtime info already available in the page.
    }

    setReloadNonce((nonce) => nonce + 1);
  }, [refreshRuntime]);

  const handleStudioRecovered = useCallback(
    (nextRuntime: StudioRuntimeSession) => {
      replaceRuntime(nextRuntime, { reload: true });
      void invalidateRuntime?.();
    },
    [invalidateRuntime, replaceRuntime],
  );

  const studioBaseUrl = selectBrowserStudioBaseUrl(studioRuntime);

  const { isRecovering: isStudioRecovering } = useStudioRuntimeGuard({
    enabled: Boolean(studioBaseUrl),
    studioBaseUrl,
    touchStudio,
    ensureStudioRunning,
    onRecovered: handleStudioRecovered,
    onRecoveryError,
  });

  const studioRuntimeUrl = studioRuntime?.runtimeUrl ?? studioRuntime?.url ?? null;
  const studioBootstrapToken = studioRuntime?.bootstrapToken ?? null;
  const studioUserActionToken = studioRuntime?.userActionToken ?? null;
  const studioCompatibilityUrl = studioRuntime?.compatibilityUrl ?? null;

  const studioBootstrapAction = useMemo(() => {
    if (!studioBaseUrl) return null;
    return resolveStudioRuntimeUrl(studioBaseUrl, "vivd-studio/api/bootstrap");
  }, [studioBaseUrl]);

  return {
    studioRuntime,
    studioBaseUrl,
    studioRuntimeUrl,
    studioCompatibilityUrl,
    studioBootstrapToken,
    studioUserActionToken,
    studioBootstrapAction,
    reloadNonce,
    isStudioRecovering,
    replaceRuntime,
    clearRuntimeOverride,
    reloadStudioIframe,
  };
}
