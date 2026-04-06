export {
  parseVivdStudioBridgeMessage,
  type VivdStudioBridgeMessage,
} from "@vivd/shared/studio";

export function getVivdStudioBridgeOrigin(studioBaseUrl: string | null): string | null {
  if (!studioBaseUrl) return null;

  try {
    return new URL(studioBaseUrl, window.location.href).origin;
  } catch {
    return null;
  }
}

export function canPostMessageToVivdStudio(options: {
  iframe: HTMLIFrameElement | null;
  studioOrigin: string | null;
}): boolean {
  const { iframe, studioOrigin } = options;
  if (!iframe || !studioOrigin) return false;
  if (typeof window === "undefined") return true;
  if (studioOrigin === window.location.origin) return true;

  const frameWindow = iframe.contentWindow;
  if (!frameWindow) return false;

  try {
    const pathname = frameWindow.location.pathname;
    if (typeof pathname === "string" && pathname.includes("/vivd-studio")) {
      return true;
    }
    return frameWindow.location.origin === studioOrigin;
  } catch {
    // Cross-origin access throws once the iframe has actually committed to the
    // studio origin. At that point postMessage(targetOrigin) is safe to use.
    return true;
  }
}
