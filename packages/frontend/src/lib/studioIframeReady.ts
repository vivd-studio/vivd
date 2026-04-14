const STUDIO_ROUTE_SEGMENT = "/vivd-studio";
const STUDIO_ASSET_SEGMENT = "/vivd-studio/assets/";

function hasStudioAssetReference(frameDocument: Document): boolean {
  const assetNodes = frameDocument.querySelectorAll("script[src], link[href]");
  return Array.from(assetNodes).some((node) => {
    const value = node.getAttribute("src") ?? node.getAttribute("href");
    return typeof value === "string" && value.includes(STUDIO_ASSET_SEGMENT);
  });
}

function hasMountedStudioRoot(frameDocument: Document): boolean {
  const root = frameDocument.getElementById("root");
  if (!root) return false;
  if (root.childElementCount > 0) return true;
  return Array.from(root.childNodes).some(
    (node) => node.nodeType === 3 && Boolean(node.textContent?.trim()),
  );
}

export function isStudioIframeShellLoaded(
  iframe: HTMLIFrameElement | null,
): boolean {
  if (!iframe) return false;

  try {
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (!frameWindow || !frameDocument) return false;
    const pathname =
      typeof frameWindow.location.pathname === "string"
        ? frameWindow.location.pathname
        : "";
    if (!pathname.includes(STUDIO_ROUTE_SEGMENT)) {
      return false;
    }
    if (!frameDocument.getElementById("root")) {
      return false;
    }

    return hasMountedStudioRoot(frameDocument) || hasStudioAssetReference(frameDocument);
  } catch {
    return false;
  }
}

export function isStudioIframePresented(
  iframe: HTMLIFrameElement | null,
): boolean {
  if (!iframe) return false;

  try {
    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument;

    if (!frameWindow) return false;
    if (frameWindow.location.href === "about:blank") {
      return false;
    }
    if (!frameDocument) return false;
    if (isStudioIframeShellLoaded(iframe)) {
      return true;
    }

    const pathname =
      typeof frameWindow.location.pathname === "string"
        ? frameWindow.location.pathname
        : "";
    const isStudioRoute = pathname.includes(STUDIO_ROUTE_SEGMENT);
    if (!isStudioRoute) return false;

    return (
      frameDocument.readyState !== "loading" &&
      (Boolean(frameDocument.getElementById("root")) ||
        hasStudioAssetReference(frameDocument))
    );
  } catch {
    // Cross-origin runtime documents are not readable here. If the frame is no longer
    // accessible, it has at least navigated away from the initial about:blank shell.
    return true;
  }
}
