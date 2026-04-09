import { scraperClient } from "../../generator/scraper-client";
import { studioMachineProvider } from "../studioMachines";
import { installProfileService } from "../system/InstallProfileService";
import {
  normalizePreviewCapturePath,
  resolvePreviewCaptureBaseUrl,
  resolvePreviewCaptureUrl,
} from "./PreviewCapture";

export type PreviewLogLevel = "debug" | "log" | "info" | "warn" | "error";
export type PreviewLogType =
  | "debug"
  | "log"
  | "info"
  | "warn"
  | "error"
  | "pageerror";

export interface PreviewLogEntry {
  type: PreviewLogType;
  text: string;
  timestamp: string;
  textTruncated: boolean;
  location?: {
    url?: string;
    line?: number;
    column?: number;
  };
}

export interface PreviewLogsCaptureOptions {
  organizationId: string;
  projectSlug: string;
  version: number;
  path?: string | null;
  waitMs?: number;
  limit?: number;
  level?: PreviewLogLevel;
  contains?: string | null;
}

export interface PreviewLogsCaptureResult {
  path: string;
  capturedUrl: string;
  waitMs: number;
  limit: number;
  level: PreviewLogLevel;
  contains?: string;
  entries: PreviewLogEntry[];
  summary: {
    observed: number;
    matched: number;
    returned: number;
    dropped: number;
    truncatedMessages: number;
  };
}

const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 200;

function normalizePreviewLogLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LOG_LIMIT;
  return Math.max(1, Math.min(Math.floor(value ?? DEFAULT_LOG_LIMIT), MAX_LOG_LIMIT));
}

function normalizePreviewLogContains(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

class PreviewLogsService {
  async capture(
    options: PreviewLogsCaptureOptions,
  ): Promise<PreviewLogsCaptureResult> {
    const runtime = await studioMachineProvider.getUrl(
      options.organizationId,
      options.projectSlug,
      options.version,
    );
    if (!runtime) {
      throw new Error(
        `Studio runtime is not running for ${options.projectSlug}/v${options.version}`,
      );
    }

    if (!runtime.accessToken) {
      throw new Error("Studio runtime access token unavailable for preview log capture");
    }

    const installProfile = await installProfileService.getInstallProfile();
    const requestedPath = normalizePreviewCapturePath(options.path);
    const captureBaseUrl = resolvePreviewCaptureBaseUrl({
      installProfile,
      backendUrl: runtime.backendUrl,
      runtimeUrl: runtime.runtimeUrl,
      compatibilityUrl: runtime.compatibilityUrl,
      url: runtime.url,
    });
    const captureUrl = resolvePreviewCaptureUrl(captureBaseUrl, requestedPath);
    const appliedLimit = normalizePreviewLogLimit(options.limit);
    const appliedLevel = options.level ?? "debug";
    const appliedContains = normalizePreviewLogContains(options.contains);

    const logCapture = await scraperClient.capturePreviewLogs({
      url: captureUrl,
      waitMs: options.waitMs,
      limit: appliedLimit,
      level: appliedLevel,
      contains: appliedContains,
      headers: {
        "x-vivd-studio-token": runtime.accessToken,
        "x-vivd-organization-id": options.organizationId,
      },
    });

    return {
      path: requestedPath,
      capturedUrl: logCapture.url,
      waitMs: logCapture.waitMs,
      limit: logCapture.limit,
      level: logCapture.level,
      contains: logCapture.contains,
      entries: logCapture.entries,
      summary: logCapture.summary,
    };
  }
}

export const previewLogsService = new PreviewLogsService();
