import {
  buildPreviewBridgeScript,
  PREVIEW_BRIDGE_MESSAGE_TYPES,
  PREVIEW_BRIDGE_NAME,
  PREVIEW_BRIDGE_VERSION,
} from "@studio/shared/previewBridge";

export {
  buildPreviewBridgeScript,
  PREVIEW_BRIDGE_MESSAGE_TYPES,
  PREVIEW_BRIDGE_NAME,
  PREVIEW_BRIDGE_VERSION,
};

export type PreviewBridgeMessageType =
  (typeof PREVIEW_BRIDGE_MESSAGE_TYPES)[number];

export type PreviewBridgeLocation = {
  href: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
};

type PreviewBridgeBaseMessage = {
  bridge: typeof PREVIEW_BRIDGE_NAME;
  version: typeof PREVIEW_BRIDGE_VERSION;
  location: PreviewBridgeLocation;
};

export type PreviewBridgeReadyMessage = PreviewBridgeBaseMessage & {
  type: "vivd:preview:ready";
};

export type PreviewBridgeNavigationMessage = PreviewBridgeBaseMessage & {
  type:
    | "vivd:preview:location-change"
    | "vivd:preview:navigation-start"
    | "vivd:preview:navigation-complete";
  reason?: string;
};

export type PreviewBridgeRuntimeErrorMessage = PreviewBridgeBaseMessage & {
  type: "vivd:preview:runtime-error";
  kind?: string;
  error?: {
    message?: string;
    stack?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
  } | null;
};

export type PreviewBridgeMessage =
  | PreviewBridgeReadyMessage
  | PreviewBridgeNavigationMessage
  | PreviewBridgeRuntimeErrorMessage;

function isPreviewBridgeLocation(value: unknown): value is PreviewBridgeLocation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.href === "string" &&
    typeof candidate.pathname === "string" &&
    typeof candidate.search === "string" &&
    typeof candidate.hash === "string" &&
    typeof candidate.origin === "string"
  );
}

function isPreviewBridgeRuntimeError(
  value: unknown,
): value is NonNullable<PreviewBridgeRuntimeErrorMessage["error"]> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    ("message" in candidate ? candidate.message === undefined || typeof candidate.message === "string" : true) &&
    ("stack" in candidate ? candidate.stack === undefined || typeof candidate.stack === "string" : true) &&
    ("filename" in candidate ? candidate.filename === undefined || typeof candidate.filename === "string" : true) &&
    ("lineno" in candidate ? candidate.lineno === undefined || typeof candidate.lineno === "number" : true) &&
    ("colno" in candidate ? candidate.colno === undefined || typeof candidate.colno === "number" : true)
  );
}

export function isPreviewBridgeMessage(
  data: unknown,
): data is PreviewBridgeMessage {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Record<string, unknown>;

  if (candidate.bridge !== PREVIEW_BRIDGE_NAME) return false;
  if (candidate.version !== PREVIEW_BRIDGE_VERSION) return false;
  if (
    !PREVIEW_BRIDGE_MESSAGE_TYPES.includes(
      candidate.type as PreviewBridgeMessageType,
    )
  ) {
    return false;
  }
  if (!isPreviewBridgeLocation(candidate.location)) return false;

  if (
    candidate.type === "vivd:preview:ready" ||
    candidate.type === "vivd:preview:location-change" ||
    candidate.type === "vivd:preview:navigation-start" ||
    candidate.type === "vivd:preview:navigation-complete"
  ) {
    return typeof candidate.reason === "undefined" || typeof candidate.reason === "string";
  }

  if (candidate.type === "vivd:preview:runtime-error") {
    return (
      (typeof candidate.kind === "undefined" || typeof candidate.kind === "string") &&
      (typeof candidate.error === "undefined" ||
        candidate.error === null ||
        isPreviewBridgeRuntimeError(candidate.error))
    );
  }

  return false;
}

export function getPreviewBridgeLocationHref(
  message: PreviewBridgeMessage,
): string {
  return message.location.href;
}

export function getPreviewBridgeOrigin(src: string): string | null {
  try {
    return new URL(src, window.location.href).origin;
  } catch {
    return null;
  }
}
