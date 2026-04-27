import {
  isStudioBootstrapStatusPayload,
  type StudioBootstrapStatusPayload,
} from "@vivd/shared/studio";
import type { StudioIframeFailure } from "./studioIframeFailure";

const DEFAULT_BOOTSTRAP_STATUS_RETRY_MS = 1_500;
const MAX_BOOTSTRAP_STATUS_RETRY_MS = 10_000;

export type StudioBootstrapStatusProbeResult =
  | {
      kind: "ready";
      payload?: StudioBootstrapStatusPayload;
      legacy?: boolean;
    }
  | {
      kind: "starting";
      payload?: StudioBootstrapStatusPayload;
      retryAfterMs: number;
    }
  | {
      kind: "failed";
      failure: StudioIframeFailure;
      payload?: StudioBootstrapStatusPayload;
    };

function parseRetryAfterMs(value: string | null): number {
  if (!value) return DEFAULT_BOOTSTRAP_STATUS_RETRY_MS;

  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(
      MAX_BOOTSTRAP_STATUS_RETRY_MS,
      Math.max(250, seconds * 1000),
    );
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(
      MAX_BOOTSTRAP_STATUS_RETRY_MS,
      Math.max(250, dateMs - Date.now()),
    );
  }

  return DEFAULT_BOOTSTRAP_STATUS_RETRY_MS;
}

function normalizeBodyText(value: string): string {
  return value.trim().toLowerCase();
}

function looksLikeLegacyStartupStatus(bodyText: string): boolean {
  const normalized = normalizeBodyText(bodyText);
  return (
    normalized.includes("studio is starting up") ||
    normalized.includes("please retry shortly") ||
    normalized.includes("runtime_starting") ||
    normalized.includes("\"status\":\"starting\"")
  );
}

function structuredFailureFromPayload(
  payload: StudioBootstrapStatusPayload,
): StudioIframeFailure {
  return {
    message: payload.message || "Studio bootstrap failed",
    status: payload.status,
    code: payload.code,
    retryable: payload.retryable,
    source: "bootstrap",
  };
}

export function classifyStudioBootstrapStatusResponse(options: {
  ok: boolean;
  status: number;
  retryAfter: string | null;
  payload: unknown;
  bodyText: string;
}): StudioBootstrapStatusProbeResult {
  const retryAfterMs = parseRetryAfterMs(options.retryAfter);

  if (isStudioBootstrapStatusPayload(options.payload)) {
    const payload = options.payload;
    if (payload.canBootstrap && payload.status === "ready") {
      return { kind: "ready", payload };
    }
    if (payload.retryable || payload.status === "starting") {
      return { kind: "starting", payload, retryAfterMs };
    }
    return {
      kind: "failed",
      payload,
      failure: structuredFailureFromPayload(payload),
    };
  }

  if (
    options.status === 503 &&
    looksLikeLegacyStartupStatus(options.bodyText)
  ) {
    return { kind: "starting", retryAfterMs };
  }

  if (options.status === 404) {
    return { kind: "ready", legacy: true };
  }

  if (options.ok) {
    return { kind: "ready", legacy: true };
  }

  return {
    kind: "starting",
    retryAfterMs,
  };
}

export async function fetchStudioBootstrapStatus(
  studioBootstrapStatusUrl: string,
  init: RequestInit = {},
): Promise<StudioBootstrapStatusProbeResult> {
  const response = await fetch(studioBootstrapStatusUrl, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    ...init,
  });

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const retryAfter = response.headers.get("retry-after");
  let payload: unknown = null;
  let bodyText = "";

  if (contentType.includes("application/json")) {
    try {
      payload = await response.clone().json();
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
  }

  return classifyStudioBootstrapStatusResponse({
    ok: response.ok,
    status: response.status,
    retryAfter,
    payload,
    bodyText,
  });
}
