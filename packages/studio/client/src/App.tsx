import { PreviewProvider, PreviewContent } from "@/components/preview";
import { Toaster } from "@/components/ui/sonner";
import {
  parseVivdHostMessage,
  postVivdHostMessage,
} from "@/lib/hostBridge";
import { useCallback, useEffect } from "react";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const embedded =
    params.get("embedded") === "1" ||
    params.get("embedded") === "true" ||
    params.get("vivdEmbedded") === "1";
  const projectSlug = params.get("projectSlug") || "studio";
  const versionParam = Number.parseInt(params.get("version") || "", 10);
  const version = Number.isFinite(versionParam) && versionParam > 0 ? versionParam : 1;
  const returnTo = params.get("returnTo");
  const publicPreviewEnabledParam = params.get("publicPreviewEnabled");
  const publicPreviewEnabled =
    publicPreviewEnabledParam === null
      ? true
      : publicPreviewEnabledParam === "1" ||
        publicPreviewEnabledParam === "true";

  const onClose = () => {
    if (embedded) {
      postVivdHostMessage({ type: "vivd:studio:close" });
      return;
    }
    if (returnTo) {
      window.location.href = returnTo;
      return;
    }
    window.history.back();
  };

  const postStudioReady = useCallback(() => {
    if (!embedded) return;
    postVivdHostMessage({ type: "vivd:studio:ready" });
  }, [embedded]);

  // Signal to the host app that the studio JS is running (iframe onLoad can fire before React mounts).
  // Also answer explicit host ready checks so a missed first message does not leave the
  // host stuck on its boot screen while the studio is already interactive.
  useEffect(() => {
    if (!embedded) return;

    postStudioReady();

    const onMessage = (event: MessageEvent) => {
      const message = parseVivdHostMessage(event);
      if (message?.type !== "vivd:host:ready-check") return;

      postStudioReady();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded, postStudioReady]);

  return (
    <>
      <PreviewProvider
        url={null}
        originalUrl={null}
        projectSlug={projectSlug}
        version={version}
        publicPreviewEnabled={publicPreviewEnabled}
        onClose={onClose}
        embedded={embedded}
      >
        <PreviewContent />
      </PreviewProvider>
      <Toaster />
    </>
  );
}
