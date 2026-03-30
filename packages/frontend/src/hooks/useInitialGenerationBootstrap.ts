import { useCallback, useMemo, useRef, type RefObject } from "react";
import { getVivdStudioBridgeOrigin } from "@/lib/studioBridge";

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
  const bootstrapKey = useMemo(
    () =>
      `${projectSlug || "unknown"}:v${version}:${studioBaseUrl || "no-runtime"}`,
    [projectSlug, studioBaseUrl, version],
  );
  const targetOrigin = useMemo(
    () => getVivdStudioBridgeOrigin(studioBaseUrl),
    [studioBaseUrl],
  );

  return useCallback(() => {
    if (!enabled) return;

    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !targetOrigin) return;

    if (bootstrappedKeyRef.current === bootstrapKey) {
      return;
    }

    targetWindow.postMessage(
      {
        type: "vivd:host:start-initial-generation",
        projectSlug,
        version,
      },
      targetOrigin,
    );
    bootstrappedKeyRef.current = bootstrapKey;
  }, [bootstrapKey, enabled, iframeRef, projectSlug, targetOrigin, version]);
}
