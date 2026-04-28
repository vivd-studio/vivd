import { useCallback, useEffect, useMemo, useState } from "react";
import { STUDIO_BOOTSTRAP_STATUS_PATH } from "@vivd/shared/studio";
import { resolveStudioRuntimeUrl } from "@/lib/studioRuntimeUrl";
import { useStudioRuntimeGuard } from "./useStudioRuntimeGuard";

export type StudioRuntimeSession = {
  url: string;
  browserUrl?: string | null;
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
  bootstrapToken: string | null;
  userActionToken?: string | null;
};

type EnsureStudioRunningResult =
  | {
      success: true;
      url: string;
      browserUrl?: string | null;
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

function pickFirstDefinedUrl(
  candidates: Array<string | null | undefined>,
): string | null {
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function resolveWindowRelativeOrigin(
  candidate: string | null | undefined,
): string | null {
  const normalized = candidate?.trim();
  if (!normalized || typeof window === "undefined") return null;

  try {
    return new URL(normalized, window.location.href).origin;
  } catch {
    return null;
  }
}

export function selectBrowserStudioBaseUrl(
  runtime: StudioRuntimeSession | null,
): string | null {
  if (!runtime) return null;

  const preferredUrl = pickFirstDefinedUrl([
    runtime.browserUrl,
    runtime.url,
    runtime.runtimeUrl,
  ]);
  const compatibilityUrl = pickFirstDefinedUrl([runtime.compatibilityUrl]);

  if (
    compatibilityUrl &&
    typeof window !== "undefined" &&
    resolveWindowRelativeOrigin(compatibilityUrl) === window.location.origin
  ) {
    const preferredOrigin = resolveWindowRelativeOrigin(preferredUrl);
    if (preferredOrigin && preferredOrigin !== window.location.origin) {
      return compatibilityUrl;
    }
  }

  return preferredUrl ?? compatibilityUrl;
}

export function selectHostProbeStudioBaseUrl(
  runtime: StudioRuntimeSession | null,
): string | null {
  if (!runtime || typeof window === "undefined") return null;

  const candidates = [
    runtime.compatibilityUrl,
    runtime.browserUrl,
    runtime.url,
    runtime.runtimeUrl,
  ];

  return pickFirstDefinedUrl(
    candidates.filter((candidate) => {
      return resolveWindowRelativeOrigin(candidate) === window.location.origin;
    }),
  );
}

export function selectBootstrapStatusStudioBaseUrl(
  runtime: StudioRuntimeSession | null,
): string | null {
  if (!runtime) return null;

  if (typeof window !== "undefined") {
    const sameOriginCompatibilityUrl = pickFirstDefinedUrl([
      runtime.compatibilityUrl,
    ]);
    if (
      sameOriginCompatibilityUrl &&
      resolveWindowRelativeOrigin(sameOriginCompatibilityUrl) ===
        window.location.origin
    ) {
      return sameOriginCompatibilityUrl;
    }
  }

  return pickFirstDefinedUrl([
    runtime.browserUrl,
    runtime.url,
    runtime.runtimeUrl,
    runtime.compatibilityUrl,
  ]);
}

function normalizeRuntimeComparisonUrl(value: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  try {
    return new URL(normalized, window.location.href)
      .toString()
      .replace(/\/+$/, "");
  } catch {
    return normalized.replace(/\/+$/, "");
  }
}

function selectRuntimeIdentityUrl(runtime: StudioRuntimeSession): string | null {
  return pickFirstDefinedUrl([
    runtime.runtimeUrl,
    runtime.url,
    runtime.browserUrl,
    runtime.compatibilityUrl,
  ]);
}

export function shouldReloadRecoveredStudioRuntime(
  current: StudioRuntimeSession | null,
  recovered: StudioRuntimeSession,
): boolean {
  if (!current) return true;

  const currentUrl = normalizeRuntimeComparisonUrl(
    selectRuntimeIdentityUrl(current),
  );
  const recoveredUrl = normalizeRuntimeComparisonUrl(
    selectRuntimeIdentityUrl(recovered),
  );

  if (!currentUrl || !recoveredUrl || currentUrl !== recoveredUrl) {
    return true;
  }

  return false;
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

  const studioBaseUrl = selectBrowserStudioBaseUrl(studioRuntime);
  const studioHostProbeBaseUrl = selectHostProbeStudioBaseUrl(studioRuntime);
  const studioBootstrapStatusBaseUrl =
    selectBootstrapStatusStudioBaseUrl(studioRuntime);

  const handleStudioRecovered = useCallback(
    (nextRuntime: StudioRuntimeSession) => {
      replaceRuntime(nextRuntime, {
        reload: shouldReloadRecoveredStudioRuntime(studioRuntime, nextRuntime),
      });
      void invalidateRuntime?.();
    },
    [invalidateRuntime, replaceRuntime, studioRuntime],
  );

  const { isRecovering: isStudioRecovering, requestRecoveryCheck } =
    useStudioRuntimeGuard({
      enabled: Boolean(studioRuntime),
      studioProbeBaseUrl: studioHostProbeBaseUrl,
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
  const studioBootstrapStatusUrl = useMemo(() => {
    if (!studioBootstrapStatusBaseUrl) return null;
    return resolveStudioRuntimeUrl(
      studioBootstrapStatusBaseUrl,
      STUDIO_BOOTSTRAP_STATUS_PATH.replace(/^\/+/, ""),
    );
  }, [studioBootstrapStatusBaseUrl]);

  return {
    studioRuntime,
    studioBaseUrl,
    studioHostProbeBaseUrl,
    studioRuntimeUrl,
    studioCompatibilityUrl,
    studioBootstrapToken,
    studioBootstrapStatusUrl,
    studioUserActionToken,
    studioBootstrapAction,
    reloadNonce,
    isStudioRecovering,
    requestStudioRecoveryCheck: requestRecoveryCheck,
    replaceRuntime,
    clearRuntimeOverride,
    reloadStudioIframe,
  };
}
