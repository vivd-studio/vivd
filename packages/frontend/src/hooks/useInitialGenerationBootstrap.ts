import { useCallback, useMemo, useRef, type RefObject } from "react";
import { getVivdStudioBridgeOrigin } from "@/lib/studioBridge";

const INITIAL_GENERATION_BOOTSTRAP_STORAGE_PREFIX =
  "vivd.initialGenerationBootstrapped";

export function getInitialGenerationBootstrapStorageKey(
  projectSlug: string | undefined,
  version: number,
): string {
  return `${INITIAL_GENERATION_BOOTSTRAP_STORAGE_PREFIX}:${projectSlug || "unknown"}:v${version}`;
}

type UseInitialGenerationBootstrapOptions = {
  enabled: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  studioBaseUrl: string | null;
  projectSlug: string | undefined;
  version: number;
};

export function useInitialGenerationBootstrap({
  enabled,
  iframeRef,
  studioBaseUrl,
  projectSlug,
  version,
}: UseInitialGenerationBootstrapOptions) {
  const bootstrappedKeyRef = useRef<string | null>(null);
  const storageKey = useMemo(
    () => getInitialGenerationBootstrapStorageKey(projectSlug, version),
    [projectSlug, version],
  );
  const targetOrigin = useMemo(
    () => getVivdStudioBridgeOrigin(studioBaseUrl),
    [studioBaseUrl],
  );

  return useCallback(() => {
    if (!enabled) return;

    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !targetOrigin) return;

    if (bootstrappedKeyRef.current === storageKey) {
      return;
    }

    try {
      if (window.sessionStorage.getItem(storageKey) === "1") {
        bootstrappedKeyRef.current = storageKey;
        return;
      }
    } catch {
      // Ignore storage issues and fall back to in-memory tracking.
    }

    targetWindow.postMessage(
      {
        type: "vivd:host:start-initial-generation",
        projectSlug,
        version,
      },
      targetOrigin,
    );
    bootstrappedKeyRef.current = storageKey;

    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Ignore storage issues and rely on in-memory tracking for this page lifetime.
    }
  }, [enabled, iframeRef, projectSlug, storageKey, targetOrigin, version]);
}
