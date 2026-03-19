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
    if (!frameWindow.location.pathname.includes(STUDIO_ROUTE_SEGMENT)) {
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
