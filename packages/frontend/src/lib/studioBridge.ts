import type { ColorTheme, Theme } from "@vivd/shared/types";

export type VivdStudioBridgeMessage =
  | { type: "vivd:studio:ready" }
  | { type: "vivd:studio:close" }
  | { type: "vivd:studio:exitFullscreen" }
  | { type: "vivd:studio:fullscreen" }
  | { type: "vivd:studio:navigate"; path: string }
  | { type: "vivd:studio:theme"; theme: Theme; colorTheme: ColorTheme }
  | { type: "vivd:studio:hardRestart"; version?: number }
  | { type: "vivd:studio:toggleSidebar" };

function hasRecordData(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseVivdStudioBridgeMessage(
  event: MessageEvent,
): VivdStudioBridgeMessage | null {
  if (!hasRecordData(event.data)) return null;
  const type = event.data.type;
  if (typeof type !== "string") return null;

  switch (type) {
    case "vivd:studio:ready":
    case "vivd:studio:close":
    case "vivd:studio:exitFullscreen":
    case "vivd:studio:fullscreen":
    case "vivd:studio:toggleSidebar":
      return { type };
    case "vivd:studio:navigate": {
      const path = event.data.path;
      return typeof path === "string" && path.length > 0 ? { type, path } : null;
    }
    case "vivd:studio:theme": {
      const theme = event.data.theme;
      const colorTheme = event.data.colorTheme;
      return typeof theme === "string" && typeof colorTheme === "string"
        ? {
            type,
            theme: theme as Theme,
            colorTheme: colorTheme as ColorTheme,
          }
        : null;
    }
    case "vivd:studio:hardRestart": {
      const version = event.data.version;
      return typeof version === "number" ? { type, version } : { type };
    }
    default:
      return null;
  }
}

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
