import * as fs from "fs";
import { scraperClient } from "../generator/scraper-client";
import {
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
} from "../generator/vivdPaths";
import { uploadProjectThumbnailBufferToBucket } from "./ProjectArtifactsService";
import { projectMetaService } from "./ProjectMetaService";
import { getInternalPreviewAccessToken } from "../config/preview";

// Base URL for the scraper (in Docker) to reach this backend's preview endpoint.
// In dev/local, use the Docker service name. In production, use the public DOMAIN.
const PREVIEW_BASE_URL =
  !process.env.DOMAIN || process.env.DOMAIN.includes("localhost")
    ? `http://backend:${process.env.PORT || 3000}`
    : process.env.DOMAIN.startsWith("http")
      ? process.env.DOMAIN
      : `https://${process.env.DOMAIN}`;
const DEBOUNCE_MS = 5000; // 5 second debounce window

type PendingGeneration = {
  timeout: NodeJS.Timeout;
  resolve: () => void;
};

/**
 * Service for generating project thumbnails.
 * Captures screenshots of preview URLs and resizes them for project cards.
 */
class ThumbnailService {
  private pendingGenerations: Map<string, PendingGeneration> = new Map();

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
    slug: string,
    version: number
  ): Promise<void> {
    const key = `${slug}-v${version}`;

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
          await this.doGenerateThumbnail(versionDir, slug, version);
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
    slug: string,
    version: number
  ): Promise<void> {
    const key = `${slug}-v${version}`;

    // Clear any pending debounced generation
    const existing = this.pendingGenerations.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.resolve();
      this.pendingGenerations.delete(key);
    }

    await this.doGenerateThumbnail(versionDir, slug, version);
  }

  private async doGenerateThumbnail(
    versionDir: string | null | undefined,
    slug: string,
    version: number
  ): Promise<void> {
    const basePreviewUrl = `${PREVIEW_BASE_URL}/vivd-studio/api/preview/${slug}/v${version}/`;

    const project = await projectMetaService.getProject(slug);
    if (!project) {
      console.warn(`[Thumbnail] Skipping for ${slug} v${version}: project not found.`);
      return;
    }

    // When a project disables public previews, use an internal token so the scraper can still fetch.
    // Token is validated server-side and stored in a short-lived cookie for subsequent asset requests.
    const previewUrl = (() => {
      if (project.publicPreviewEnabled) return basePreviewUrl;

      const token = getInternalPreviewAccessToken();
      if (!token) {
        console.warn(
          `[Thumbnail] Skipping for ${slug} v${version}: public preview URLs are disabled but no PREVIEW_INTERNAL_TOKEN/SCRAPER_API_KEY configured.`,
        );
        return null;
      }

      return `${basePreviewUrl}?__vivd_preview_token=${encodeURIComponent(token)}`;
    })();

    if (!previewUrl) return;

    console.log(`[Thumbnail] Generating for ${slug} v${version}...`);

    try {
      // Capture thumbnail via scraper service
      const base64Thumbnail = await scraperClient.captureThumbnail(
        previewUrl,
        640,
        400
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
          buffer: thumbnailBuffer,
          slug,
          version,
        });

        if (uploaded.uploaded && uploaded.key) {
          await projectMetaService.setVersionThumbnailKey({
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

      console.log(`[Thumbnail] Generated successfully for ${slug} v${version}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Thumbnail] Failed for ${slug} v${version}: ${message}`);
      throw err;
    }
  }
}

// Export singleton instance
export const thumbnailService = new ThumbnailService();
