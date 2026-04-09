import type { StudioMachineProviderKind, StudioMachineUrlResult } from "../studioMachines/types";
import { studioMachineProvider } from "../studioMachines";

const STUDIO_FETCH_TIMEOUT_MS = 10_000;

export type PreviewRuntimeHealthStatus =
  | "ok"
  | "starting"
  | "unreachable"
  | "stopped";

export type PreviewModeStatus = "static" | "devserver" | "unknown";
export type PreviewStatusValue =
  | "ready"
  | "starting"
  | "installing"
  | "error"
  | "unavailable";

export type DevServerStatusValue =
  | "ready"
  | "starting"
  | "installing"
  | "error"
  | "not_applicable"
  | "unknown";

export interface PreviewStatusResult {
  provider: StudioMachineProviderKind;
  runtime: {
    running: boolean;
    health: PreviewRuntimeHealthStatus;
    browserUrl: string | null;
    runtimeUrl: string | null;
    compatibilityUrl: string | null;
    error?: string;
  };
  preview: {
    mode: PreviewModeStatus;
    status: PreviewStatusValue;
    error?: string;
  };
  devServer: {
    applicable: boolean;
    running: boolean;
    status: DevServerStatusValue;
  };
}

type PreviewInfoResponse = {
  mode: "static" | "devserver";
  status: "ready" | "starting" | "installing" | "error";
  url: string;
  error?: string;
};

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveStudioRuntimeUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  if (!url.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    url.pathname = `${url.pathname}/`;
  }
  return new URL(path.replace(/^\/+/, ""), ensureTrailingSlash(url.toString())).toString();
}

function getStudioCallBaseUrl(runtime: StudioMachineUrlResult): string {
  const candidates = [
    runtime.backendUrl,
    runtime.runtimeUrl,
    runtime.compatibilityUrl,
    runtime.url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  throw new Error("Studio runtime did not provide a usable URL");
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = STUDIO_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapTrpcBody<T>(body: any): T {
  return (body?.result?.data?.json ?? body?.result?.data ?? body) as T;
}

async function readRuntimeHealth(runtimeBaseUrl: string): Promise<{
  health: PreviewRuntimeHealthStatus;
  error?: string;
}> {
  try {
    const response = await fetchWithTimeout(resolveStudioRuntimeUrl(runtimeBaseUrl, "health"), {
      method: "GET",
    });

    if (!response.ok) {
      return {
        health: "unreachable",
        error: `Studio health check failed with status ${response.status}`,
      };
    }

    const body = (await response.json().catch(() => null)) as
      | { status?: string; initialized?: boolean }
      | null;

    if (body?.status === "ok" || body?.initialized === true) {
      return { health: "ok" };
    }

    if (body?.status === "starting") {
      return { health: "starting" };
    }

    return {
      health: "unreachable",
      error: `Studio health is ${body?.status ?? "unknown"}`,
    };
  } catch (error) {
    return {
      health: "unreachable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readPreviewInfo(
  runtimeBaseUrl: string,
  accessToken: string | undefined,
  input: { slug: string; version: number },
): Promise<{ info?: PreviewInfoResponse; error?: string }> {
  try {
    const url = `${resolveStudioRuntimeUrl(
      runtimeBaseUrl,
      "vivd-studio/api/trpc/project.getPreviewInfo",
    )}?input=${encodeURIComponent(JSON.stringify(input))}`;

    const headers: Record<string, string> = {};
    const normalizedAccessToken = accessToken?.trim();
    if (normalizedAccessToken) {
      headers["x-vivd-studio-token"] = normalizedAccessToken;
    }

    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        error: detail.trim()
          ? `Runtime preview status failed (${response.status}): ${detail.trim()}`
          : `Runtime preview status failed (${response.status})`,
      };
    }

    return {
      info: unwrapTrpcBody<PreviewInfoResponse>(await response.json()),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function deriveDevServerState(preview: PreviewStatusResult["preview"]): PreviewStatusResult["devServer"] {
  if (preview.mode === "static") {
    return {
      applicable: false,
      running: false,
      status: "not_applicable",
    };
  }

  if (preview.mode === "devserver") {
    return {
      applicable: true,
      running: preview.status === "ready",
      status:
        preview.status === "ready" ||
        preview.status === "starting" ||
        preview.status === "installing" ||
        preview.status === "error"
          ? preview.status
          : "unknown",
    };
  }

  return {
    applicable: false,
    running: false,
    status: "unknown",
  };
}

class PreviewStatusService {
  async getStatus(options: {
    organizationId: string;
    projectSlug: string;
    version: number;
  }): Promise<PreviewStatusResult> {
    const runtime = await studioMachineProvider.getUrl(
      options.organizationId,
      options.projectSlug,
      options.version,
    );

    if (!runtime) {
      return {
        provider: studioMachineProvider.kind,
        runtime: {
          running: false,
          health: "stopped",
          browserUrl: null,
          runtimeUrl: null,
          compatibilityUrl: null,
        },
        preview: {
          mode: "unknown",
          status: "unavailable",
          error: "Studio runtime is not running",
        },
        devServer: {
          applicable: false,
          running: false,
          status: "unknown",
        },
      };
    }

    const runtimeBaseUrl = getStudioCallBaseUrl(runtime);
    const health = await readRuntimeHealth(runtimeBaseUrl);
    const previewInfo = await readPreviewInfo(runtimeBaseUrl, runtime.accessToken, {
      slug: options.projectSlug,
      version: options.version,
    });

    const preview: PreviewStatusResult["preview"] = previewInfo.info
      ? {
          mode: previewInfo.info.mode,
          status: previewInfo.info.status,
          error: previewInfo.info.error,
        }
      : {
          mode: "unknown",
          status: "unavailable",
          error: previewInfo.error,
        };

    return {
      provider: studioMachineProvider.kind,
      runtime: {
        running: true,
        health: health.health,
        browserUrl: runtime.url ?? null,
        runtimeUrl: runtime.runtimeUrl ?? null,
        compatibilityUrl: runtime.compatibilityUrl ?? null,
        error: health.error,
      },
      preview,
      devServer: deriveDevServerState(preview),
    };
  }
}

export const previewStatusService = new PreviewStatusService();
