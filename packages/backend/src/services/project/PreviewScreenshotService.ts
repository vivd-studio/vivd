import path from "node:path";
import { scraperClient } from "../../generator/scraper-client";
import { studioMachineProvider } from "../studioMachines";
import { installProfileService } from "../system/InstallProfileService";

export type PreviewScreenshotFormat = "png" | "jpeg" | "webp";

export interface PreviewScreenshotCaptureOptions {
  organizationId: string;
  projectSlug: string;
  version: number;
  path?: string | null;
  width?: number;
  height?: number;
  scrollX?: number;
  scrollY?: number;
  waitMs?: number;
  format?: PreviewScreenshotFormat;
}

export interface PreviewScreenshotCaptureResult {
  path: string;
  capturedUrl: string;
  filename: string;
  mimeType: string;
  format: PreviewScreenshotFormat;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  imageBase64: string;
}

const DEFAULT_CAPTURE_WIDTH = 1440;
const DEFAULT_CAPTURE_HEIGHT = 900;
const DEFAULT_CAPTURE_WAIT_MS = 500;

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value ?? fallback));
}

function toNonNegativeInt(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
}

function sanitizeFilenameSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "preview";
}

export function normalizePreviewScreenshotPath(
  rawPath: string | null | undefined,
): string {
  const trimmed = rawPath?.trim() || "/";
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error("Preview screenshot path must be preview-relative, not a full URL");
  }

  const normalized = trimmed.startsWith("/")
    ? trimmed
    : `/${trimmed.replace(/^\/+/, "")}`;
  const parsed = new URL(normalized, "https://vivd.invalid");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function buildPreviewScreenshotFilename(options: {
  path: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  format: PreviewScreenshotFormat;
}): string {
  const parsed = new URL(options.path, "https://vivd.invalid");
  const pathSlug =
    parsed.pathname === "/"
      ? "home"
      : sanitizeFilenameSegment(parsed.pathname.split("/").filter(Boolean).join("-"));
  const scrollSuffix =
    options.scrollX > 0 || options.scrollY > 0
      ? `-x${options.scrollX}-y${options.scrollY}`
      : "";

  return `preview-${pathSlug}-${options.width}x${options.height}${scrollSuffix}.${options.format}`;
}

export function resolvePreviewScreenshotBaseUrl(options: {
  installProfile: "solo" | "platform";
  runtimeUrl?: string | null;
  compatibilityUrl?: string | null;
  url: string;
}): string {
  const runtimeUrl = options.runtimeUrl?.trim() || null;
  const compatibilityUrl = options.compatibilityUrl?.trim() || null;

  if (options.installProfile !== "platform" && compatibilityUrl) {
    return compatibilityUrl;
  }

  return runtimeUrl || compatibilityUrl || options.url;
}

export function resolvePreviewScreenshotUrl(
  baseUrl: string,
  requestedPath: string,
): string {
  const base = new URL(baseUrl);
  const parsedPath = new URL(requestedPath, "https://vivd.invalid");
  const basePathname = base.pathname.replace(/\/+$/, "") || "/";

  base.pathname = path.posix.join(basePathname, parsedPath.pathname);
  base.search = parsedPath.search;
  base.hash = parsedPath.hash;
  return base.toString();
}

class PreviewScreenshotService {
  async capture(
    options: PreviewScreenshotCaptureOptions,
  ): Promise<PreviewScreenshotCaptureResult> {
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
      throw new Error("Studio runtime access token unavailable for preview capture");
    }

    const installProfile = await installProfileService.getInstallProfile();
    const requestedPath = normalizePreviewScreenshotPath(options.path);
    const width = toPositiveInt(options.width, DEFAULT_CAPTURE_WIDTH);
    const height = toPositiveInt(options.height, DEFAULT_CAPTURE_HEIGHT);
    const scrollX = toNonNegativeInt(options.scrollX);
    const scrollY = toNonNegativeInt(options.scrollY);
    const waitMs = toNonNegativeInt(options.waitMs ?? DEFAULT_CAPTURE_WAIT_MS);
    const format = options.format ?? "png";
    const captureBaseUrl = resolvePreviewScreenshotBaseUrl({
      installProfile,
      runtimeUrl: runtime.runtimeUrl,
      compatibilityUrl: runtime.compatibilityUrl,
      url: runtime.url,
    });
    const captureUrl = resolvePreviewScreenshotUrl(captureBaseUrl, requestedPath);

    const screenshot = await scraperClient.captureScreenshot({
      url: captureUrl,
      width,
      height,
      scrollX,
      scrollY,
      waitMs,
      format,
      filename: buildPreviewScreenshotFilename({
        path: requestedPath,
        width,
        height,
        scrollX,
        scrollY,
        format,
      }),
      headers: {
        "x-vivd-studio-token": runtime.accessToken,
        "x-vivd-organization-id": options.organizationId,
      },
    });

    return {
      path: requestedPath,
      capturedUrl: screenshot.url,
      filename: screenshot.filename,
      mimeType: screenshot.mimeType,
      format,
      width,
      height,
      scrollX,
      scrollY,
      imageBase64: screenshot.data,
    };
  }
}

export const previewScreenshotService = new PreviewScreenshotService();
