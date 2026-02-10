import { PreviewProvider, PreviewContent } from "@/components/preview";
import { Toaster } from "@/components/ui/sonner";

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
      window.parent?.postMessage({ type: "vivd:studio:close" }, "*");
      return;
    }
    if (returnTo) {
      window.location.href = returnTo;
      return;
    }
    window.history.back();
  };

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
