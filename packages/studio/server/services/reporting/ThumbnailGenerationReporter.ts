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
} from "@vivd/shared";
import {
  buildConnectedBackendHeaders,
  getConnectedBackendAuthConfig,
} from "../../lib/connectedBackendAuth.js";

const REQUEST_THROTTLE_MS = 1500;
const ERROR_COOLDOWN_MS_DEFAULT = 15_000;
const ERROR_COOLDOWN_MS_NOT_FOUND = 2 * 60_000;

class ThumbnailGenerationReporter {
  private lastRequestByKey = new Map<string, number>();
  private inflightByKey = new Map<string, Promise<void>>();
  private cooldownUntilByKey = new Map<string, number>();

  private setErrorCooldown(key: string, ms: number): void {
    this.cooldownUntilByKey.set(key, Date.now() + ms);
  }

  private clearErrorCooldown(key: string): void {
    this.cooldownUntilByKey.delete(key);
  }

  private getStatusFromErrorText(errorText: string): string | null {
    try {
      const parsed = JSON.parse(errorText) as {
        error?: {
          data?: { code?: string };
          message?: string;
        };
      };
      return parsed.error?.data?.code || parsed.error?.message || null;
    } catch {
      return null;
    }
  }

  request(slug: string, version: number): void {
    if (!isConnectedMode()) return;

    const config = getConnectedBackendAuthConfig();
    if (!config) return;

    // Prefer machine-provided slug to avoid stale route/input slugs in connected mode.
    const machineSlug = (process.env.VIVD_PROJECT_SLUG || "").trim();
    const normalizedSlug = (machineSlug || slug).trim();
    if (!normalizedSlug) return;

    const normalizedVersion = Number(version);
    if (!Number.isFinite(normalizedVersion) || normalizedVersion < 1) return;

    const key = `${normalizedSlug}:v${normalizedVersion}`;

    const cooldownUntil = this.cooldownUntilByKey.get(key) ?? 0;
    if (cooldownUntil > Date.now()) return;

    const now = Date.now();
    const last = this.lastRequestByKey.get(key) ?? 0;
    if (now - last < REQUEST_THROTTLE_MS) return;
    this.lastRequestByKey.set(key, now);

    if (this.inflightByKey.has(key)) return;

    const promise = fetch(`${config.backendUrl}/api/trpc/studioApi.generateThumbnail`, {
      method: "POST",
      headers: buildConnectedBackendHeaders(config),
      body: JSON.stringify({
        studioId: config.studioId,
        slug: normalizedSlug,
        version: normalizedVersion,
      }),
    })
      .then(async (response) => {
        if (response.ok) {
          this.clearErrorCooldown(key);
          return;
        }
        const errorText = await response.text().catch(() => "Unknown error");
        const normalizedStatus = this.getStatusFromErrorText(errorText);
        const isNotFound =
          response.status === 404 || normalizedStatus === "NOT_FOUND";
        const cooldownMs = isNotFound
          ? ERROR_COOLDOWN_MS_NOT_FOUND
          : ERROR_COOLDOWN_MS_DEFAULT;
        this.setErrorCooldown(key, cooldownMs);
        console.warn(
          `[ThumbnailGenerationReporter] Backend request failed ${response.status}: ${errorText}. Cooling down ${Math.round(cooldownMs / 1000)}s before retry.`,
        );
      })
      .catch((err) => {
        this.setErrorCooldown(key, ERROR_COOLDOWN_MS_DEFAULT);
        console.warn("[ThumbnailGenerationReporter] Network error:", err);
      })
      .finally(() => {
        this.inflightByKey.delete(key);
      });

    this.inflightByKey.set(key, promise);
  }
}

export const thumbnailGenerationReporter = new ThumbnailGenerationReporter();
