/**
 * Thumbnail Generation Reporter
 *
 * In connected mode, requests the main backend to regenerate a project's thumbnail
 * after snapshot/build artifacts have been synced to object storage.
 *
 * In standalone mode, this is a no-op.
 */

import {
  isConnectedMode,
  getBackendUrl,
  getConnectedOrganizationId,
  getSessionToken,
  getStudioId,
} from "@vivd/shared";

const REQUEST_THROTTLE_MS = 1500;

class ThumbnailGenerationReporter {
  private lastRequestByKey = new Map<string, number>();
  private inflightByKey = new Map<string, Promise<void>>();

  request(slug: string, version: number): void {
    if (!isConnectedMode()) return;

    const backendUrl = getBackendUrl();
    const sessionToken = getSessionToken();
    const studioId = getStudioId();
    const organizationId = getConnectedOrganizationId();
    if (!backendUrl || !sessionToken || !studioId) return;

    const normalizedSlug = slug.trim();
    if (!normalizedSlug) return;

    const normalizedVersion = Number(version);
    if (!Number.isFinite(normalizedVersion) || normalizedVersion < 1) return;

    const key = `${normalizedSlug}:v${normalizedVersion}`;

    const now = Date.now();
    const last = this.lastRequestByKey.get(key) ?? 0;
    if (now - last < REQUEST_THROTTLE_MS) return;
    this.lastRequestByKey.set(key, now);

    if (this.inflightByKey.has(key)) return;

    const promise = fetch(`${backendUrl}/api/trpc/studioApi.generateThumbnail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
        ...(organizationId
          ? { "x-vivd-organization-id": organizationId }
          : {}),
      },
      body: JSON.stringify({
        studioId,
        slug: normalizedSlug,
        version: normalizedVersion,
      }),
    })
      .then(async (response) => {
        if (response.ok) return;
        const errorText = await response.text().catch(() => "Unknown error");
        console.warn(
          `[ThumbnailGenerationReporter] Backend request failed ${response.status}: ${errorText}`,
        );
      })
      .catch((err) => {
        console.warn("[ThumbnailGenerationReporter] Network error:", err);
      })
      .finally(() => {
        this.inflightByKey.delete(key);
      });

    this.inflightByKey.set(key, promise);
  }
}

export const thumbnailGenerationReporter = new ThumbnailGenerationReporter();
