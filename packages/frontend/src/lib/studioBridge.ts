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
  return Boolean(iframe.contentWindow);
}
