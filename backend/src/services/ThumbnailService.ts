import * as fs from "fs";
import { scraperClient } from "../generator/scraper-client";
import {
  ensureVivdInternalFilesDir,
  getVivdInternalFilesPath,
} from "../generator/vivdPaths";

// Base URL for the scraper to reach this backend's preview endpoint
// In production, use the public DOMAIN. In development, fall back to localhost.
const PREVIEW_BASE_URL = process.env.DOMAIN
  ? `https://${process.env.DOMAIN}`
  : `http://localhost:${process.env.PORT || 3000}`;
const DEBOUNCE_MS = 5000; // 5 second debounce window

/**
 * Service for generating project thumbnails.
 * Captures screenshots of preview URLs and resizes them for project cards.
 */
class ThumbnailService {
  private pendingGenerations: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Generate a thumbnail for a project version.
   * Uses debouncing to avoid rapid regeneration on frequent saves.
   *
   * @param versionDir - Path to the version directory
   * @param slug - Project slug
   * @param version - Version number
   */
  async generateThumbnail(
    versionDir: string,
    slug: string,
    version: number
  ): Promise<void> {
    const key = `${slug}-v${version}`;

    // Clear any pending generation for this version
    const existing = this.pendingGenerations.get(key);
    if (existing) {
      clearTimeout(existing);
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

      this.pendingGenerations.set(key, timeout);
    });
  }

  /**
   * Generate a thumbnail immediately without debouncing.
   * Use this for initial generation after project creation.
   */
  async generateThumbnailImmediate(
    versionDir: string,
    slug: string,
    version: number
  ): Promise<void> {
    const key = `${slug}-v${version}`;

    // Clear any pending debounced generation
    const existing = this.pendingGenerations.get(key);
    if (existing) {
      clearTimeout(existing);
      this.pendingGenerations.delete(key);
    }

    await this.doGenerateThumbnail(versionDir, slug, version);
  }

  private async doGenerateThumbnail(
    versionDir: string,
    slug: string,
    version: number
  ): Promise<void> {
    // Skip if version directory doesn't exist
    if (!fs.existsSync(versionDir)) {
      console.log(`[Thumbnail] Skipping - version dir not found: ${versionDir}`);
      return;
    }

    // Construct preview URL that the scraper can reach
    const previewUrl = `${PREVIEW_BASE_URL}/vivd-studio/api/preview/${slug}/v${version}/`;

    console.log(`[Thumbnail] Generating for ${slug} v${version}...`);

    try {
      // Capture thumbnail via scraper service
      const base64Thumbnail = await scraperClient.captureThumbnail(
        previewUrl,
        640,
        400
      );

      // Ensure .vivd directory exists
      ensureVivdInternalFilesDir(versionDir);

      // Save thumbnail
      const thumbnailPath = getVivdInternalFilesPath(versionDir, "thumbnail.webp");
      const thumbnailBuffer = Buffer.from(base64Thumbnail, "base64");
      fs.writeFileSync(thumbnailPath, thumbnailBuffer);

      console.log(`[Thumbnail] Generated successfully: ${thumbnailPath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Thumbnail] Failed for ${slug} v${version}: ${message}`);
      throw err;
    }
  }
}

// Export singleton instance
export const thumbnailService = new ThumbnailService();
