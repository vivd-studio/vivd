import * as fs from "fs";
import { isIP } from "node:net";
import { scraperClient } from "../../generator/scraper-client";
import {
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
} from "../../generator/vivdPaths";
import { uploadProjectThumbnailBufferToBucket } from "./ProjectArtifactsService";
import { projectMetaService } from "./ProjectMetaService";
import { getInternalPreviewAccessToken } from "../../config/preview";
import { instanceNetworkSettingsService } from "../system/InstanceNetworkSettingsService";

const DEBOUNCE_MS = 5000; // 5 second debounce window
const NON_RETRYABLE_COOLDOWN_MS = 60_000;
const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_HTTP_STATUS_CODES = new Set([400, 401, 403, 404, 405, 410, 422]);

type PendingGeneration = {
  timeout: NodeJS.Timeout;
  resolve: () => void;
};

type FailureCooldown = {
  until: number;
  reason: string;
};

function normalizeOrigin(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || "";
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  const host = trimmed.replace(/\/+$/, "");
  const isLocalLike =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    isIP(host) !== 0;
  return `${isLocalLike ? "http" : "https"}://${host}`;
}

function parseHostLike(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || "";
  if (!trimmed) return null;

  try {
    const parsed = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`http://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .toLowerCase();
  }
}

function resolveLocalPreviewBaseUrl(): string {
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}`;
}

function resolveDockerPreviewBaseUrl(): string {
  const port = process.env.PORT?.trim() || "3000";
  return `http://backend:${port}`;
}

function isLocalScraperHost(host: string | null): boolean {
  if (!host) return false;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost")
  );
}

function isDockerServiceLikeHost(host: string | null): boolean {
  if (!host) return false;
  if (isLocalScraperHost(host)) return false;
  if (isIP(host) !== 0) return false;
  return !host.includes(".");
}

export function resolveThumbnailPreviewBaseUrl(): string {
  const explicit = normalizeOrigin(process.env.VIVD_THUMBNAIL_PREVIEW_BASE_URL);
  if (explicit) return explicit;

  const scraperHost = parseHostLike(process.env.SCRAPER_URL || "http://scraper:3001");
  if (isLocalScraperHost(scraperHost)) {
    return resolveLocalPreviewBaseUrl();
  }
  if (isDockerServiceLikeHost(scraperHost)) {
    return resolveDockerPreviewBaseUrl();
  }

  const networkOrigin = instanceNetworkSettingsService.getResolvedSettings().publicOrigin;
  if (networkOrigin) return networkOrigin.replace(/\/+$/, "");

  const backendUrl = normalizeOrigin(process.env.BACKEND_URL);
  if (backendUrl) return backendUrl;

  const domainOrigin = normalizeOrigin(process.env.DOMAIN);
  if (domainOrigin) return domainOrigin;

  return resolveLocalPreviewBaseUrl();
}

function extractPreviewHttpStatus(message: string): number | null {
  const match = message.match(/HTTP\s+(\d{3})/i);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldRetryCaptureError(message: string): boolean {
  const status = extractPreviewHttpStatus(message);
  if (status !== null) {
    return RETRYABLE_HTTP_STATUS_CODES.has(status);
  }

  // JSON responses from preview are usually policy/gating failures, not transient startup errors.
  if (message.includes("Preview returned JSON instead of HTML")) {
    return false;
  }

  // Unknown/non-HTTP failures (timeouts, browser flakiness, network hiccups) can be retried.
  return true;
}

function shouldCooldownAfterFailure(message: string): boolean {
  const status = extractPreviewHttpStatus(message);
  if (status !== null) {
    return NON_RETRYABLE_HTTP_STATUS_CODES.has(status);
  }
  return message.includes("Preview returned JSON instead of HTML");
}

/**
 * Service for generating project thumbnails.
 * Captures screenshots of preview URLs and resizes them for project cards.
 */
class ThumbnailService {
  private pendingGenerations: Map<string, PendingGeneration> = new Map();
  private failureCooldownByKey: Map<string, FailureCooldown> = new Map();

  private async captureThumbnailWithRetry(
    previewUrl: string,
    slug: string,
    version: number,
    headers?: Record<string, string>,
  ): Promise<string> {
    const maxAttempts = 4;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await scraperClient.captureThumbnail(previewUrl, 640, 400, headers);
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const retryable = shouldRetryCaptureError(message);
        if (!retryable) {
          console.warn(
            `[Thumbnail] Capture attempt ${attempt}/${maxAttempts} failed for ${slug} v${version}: ${message}. Not retrying.`,
          );
          break;
        }
        if (attempt >= maxAttempts) break;

        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        console.warn(
          `[Thumbnail] Capture attempt ${attempt}/${maxAttempts} failed for ${slug} v${version}: ${message}. Retrying in ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw (
      lastError ??
      new Error(`Thumbnail capture failed after ${maxAttempts} attempts`)
    );
  }

  /**
   * Generate a thumbnail for a project version.
   * Uses debouncing to avoid rapid regeneration on frequent saves.
   *
   * @param versionDir - Path to the version directory (optional; used only for local persistence)
   * @param slug - Project slug
   * @param version - Version number
   */
  async generateThumbnail(
    versionDir: string | null | undefined,
    organizationId: string,
    slug: string,
    version: number
  ): Promise<void> {
    const key = `${organizationId}:${slug}-v${version}`;

    // Clear any pending generation for this version
    const existing = this.pendingGenerations.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.resolve();
      this.pendingGenerations.delete(key);
    }

    // Debounce: wait before generating to avoid rapid regeneration
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        this.pendingGenerations.delete(key);
        try {
          await this.doGenerateThumbnail(versionDir, organizationId, slug, version);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, DEBOUNCE_MS);

      this.pendingGenerations.set(key, { timeout, resolve });
    });
  }

  /**
   * Generate a thumbnail immediately without debouncing.
   * Use this for initial generation after project creation.
   */
  async generateThumbnailImmediate(
    versionDir: string | null | undefined,
    organizationId: string,
    slug: string,
    version: number
  ): Promise<void> {
    const key = `${organizationId}:${slug}-v${version}`;

    // Clear any pending debounced generation
    const existing = this.pendingGenerations.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.resolve();
      this.pendingGenerations.delete(key);
    }

    await this.doGenerateThumbnail(versionDir, organizationId, slug, version);
  }

  private async doGenerateThumbnail(
    versionDir: string | null | undefined,
    organizationId: string,
    slug: string,
    version: number
  ): Promise<void> {
    const key = `${organizationId}:${slug}-v${version}`;
    const cooldown = this.failureCooldownByKey.get(key);
    if (cooldown) {
      if (cooldown.until > Date.now()) {
        const secondsLeft = Math.max(
          1,
          Math.ceil((cooldown.until - Date.now()) / 1000),
        );
        console.warn(
          `[Thumbnail] Skipping for ${slug} v${version}: cooling down after recent non-retryable failure (${secondsLeft}s left). Last error: ${cooldown.reason}`,
        );
        return;
      }
      this.failureCooldownByKey.delete(key);
    }

    const basePreviewUrl = `${resolveThumbnailPreviewBaseUrl()}/vivd-studio/api/preview/${slug}/v${version}/`;

    const project = await projectMetaService.getProject(organizationId, slug);
    if (!project) {
      console.warn(`[Thumbnail] Skipping for ${slug} v${version}: project not found.`);
      return;
    }

    const token = getInternalPreviewAccessToken();
    if (!token) {
      console.warn(
        `[Thumbnail] Skipping for ${slug} v${version}: no PREVIEW_INTERNAL_TOKEN/SCRAPER_API_KEY configured.`,
      );
      return;
    }

    const previewUrl = basePreviewUrl;
    const previewHeaders = {
      "x-vivd-preview-token": token,
      "x-vivd-organization-id": organizationId,
    };

    console.log(`[Thumbnail] Generating for ${slug} v${version}...`);

    try {
      // Capture thumbnail via scraper service
      const base64Thumbnail = await this.captureThumbnailWithRetry(
        previewUrl,
        slug,
        version,
        previewHeaders,
      );

      const thumbnailBuffer = Buffer.from(base64Thumbnail, "base64");

      // Optionally persist thumbnail to the local project directory (best-effort).
      if (versionDir && fs.existsSync(versionDir)) {
        try {
          ensureVivdInternalFilesDir(versionDir);
          const thumbnailPath = getVivdInternalFilesPath(versionDir, "thumbnail.webp");
          fs.writeFileSync(thumbnailPath, thumbnailBuffer);
        } catch (writeErr) {
          const message =
            writeErr instanceof Error ? writeErr.message : String(writeErr);
          console.warn(`[Thumbnail] Local write failed: ${message}`);
        }
      }

      // Upload thumbnail to object storage (best-effort) and persist key in DB.
      try {
        const uploaded = await uploadProjectThumbnailBufferToBucket({
          organizationId,
          buffer: thumbnailBuffer,
          slug,
          version,
        });

        if (uploaded.uploaded && uploaded.key) {
          await projectMetaService.setVersionThumbnailKey({
            organizationId,
            slug,
            version,
            thumbnailKey: uploaded.key,
          });
        }
      } catch (uploadErr) {
        const message =
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        console.warn(`[Thumbnail] Bucket upload failed: ${message}`);
      }

      this.failureCooldownByKey.delete(key);
      console.log(`[Thumbnail] Generated successfully for ${slug} v${version}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (shouldCooldownAfterFailure(message)) {
        const until = Date.now() + NON_RETRYABLE_COOLDOWN_MS;
        this.failureCooldownByKey.set(key, { until, reason: message });
        console.warn(
          `[Thumbnail] Cooling down ${slug} v${version} for ${Math.round(
            NON_RETRYABLE_COOLDOWN_MS / 1000,
          )}s after non-retryable failure.`,
        );
      }
      console.error(`[Thumbnail] Failed for ${slug} v${version}: ${message}`);
      throw err;
    }
  }
}

// Export singleton instance
export const thumbnailService = new ThumbnailService();
