import type { ColorTheme, Theme } from "../types/index.js";

export type VivdStudioBridgeMessage =
  | { type: "vivd:studio:ready" }
  | {
      type: "vivd:studio:transport-degraded";
      transport: "trpc-http";
      reason: "network-error" | "timeout";
    }
  | { type: "vivd:studio:close" }
  | { type: "vivd:studio:exitFullscreen" }
  | { type: "vivd:studio:fullscreen" }
  | { type: "vivd:studio:navigate"; path: string }
  | { type: "vivd:studio:theme"; theme: Theme; colorTheme: ColorTheme }
  | { type: "vivd:studio:hardRestart"; version?: number }
  | { type: "vivd:studio:showSidebarPeek" }
  | { type: "vivd:studio:scheduleHideSidebarPeek" }
  | { type: "vivd:studio:toggleSidebar" };

export type VivdHostBridgeMessage =
  | { type: "vivd:host:ready-check" }
  | { type: "vivd:host:ready-ack" }
  | { type: "vivd:host:theme"; theme: Theme; colorTheme: ColorTheme }
  | { type: "vivd:host:sidebar"; open: boolean };

function hasRecordData(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseVivdStudioBridgeMessageData(
  data: unknown,
): VivdStudioBridgeMessage | null {
  if (!hasRecordData(data)) return null;
  const type = data.type;
  if (typeof type !== "string") return null;

  switch (type) {
    case "vivd:studio:ready":
    case "vivd:studio:close":
    case "vivd:studio:exitFullscreen":
    case "vivd:studio:fullscreen":
    case "vivd:studio:showSidebarPeek":
    case "vivd:studio:scheduleHideSidebarPeek":
    case "vivd:studio:toggleSidebar":
      return { type };
    case "vivd:studio:transport-degraded": {
      const transport = data.transport;
      const reason = data.reason;
      return transport === "trpc-http" &&
        (reason === "network-error" || reason === "timeout")
        ? { type, transport, reason }
        : null;
    }
    case "vivd:studio:navigate": {
      const path = data.path;
      return typeof path === "string" && path.length > 0 ? { type, path } : null;
    }
    case "vivd:studio:theme": {
      const theme = data.theme;
      const colorTheme = data.colorTheme;
      return typeof theme === "string" && typeof colorTheme === "string"
        ? {
            type,
            theme: theme as Theme,
            colorTheme: colorTheme as ColorTheme,
          }
        : null;
    }
    case "vivd:studio:hardRestart": {
      const version = data.version;
      return typeof version === "number" ? { type, version } : { type };
    }
    default:
      return null;
  }
}

export function parseVivdHostBridgeMessageData(
  data: unknown,
): VivdHostBridgeMessage | null {
  if (!hasRecordData(data)) return null;
  const type = data.type;
  if (typeof type !== "string") return null;

  switch (type) {
    case "vivd:host:ready-check":
    case "vivd:host:ready-ack":
      return { type };
    case "vivd:host:theme": {
      const theme = data.theme;
      const colorTheme = data.colorTheme;
      return typeof theme === "string" && typeof colorTheme === "string"
        ? {
            type,
            theme: theme as Theme,
            colorTheme: colorTheme as ColorTheme,
          }
        : null;
    }
    case "vivd:host:sidebar": {
      const open = data.open;
      return typeof open === "boolean" ? { type, open } : null;
    }
    default:
      return null;
  }
}

export function parseVivdStudioBridgeMessage(
  event: MessageEvent,
): VivdStudioBridgeMessage | null {
  return parseVivdStudioBridgeMessageData(event.data);
}

export function parseVivdHostBridgeMessage(
  event: MessageEvent,
): VivdHostBridgeMessage | null {
  return parseVivdHostBridgeMessageData(event.data);
}
