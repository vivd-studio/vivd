/**
 * Studio mode detection for standalone studio operation.
 *
 * - Standalone mode (default): No backend connection, unlimited usage
 * - Connected mode: Reports usage to main backend, enforces limits
 *
 * Mode is inferred from MAIN_BACKEND_URL: if set, we're in connected mode.
 */

import type { StudioConfig } from "../types/studioMode.js";

/**
 * Get the main backend URL.
 * Returns undefined if not configured.
 */
export function getBackendUrl(): string | undefined {
  return process.env.MAIN_BACKEND_URL;
}

/**
 * Get the studio operating mode.
 * Inferred from MAIN_BACKEND_URL: if set, we're connected.
 */
export function getStudioMode(): "standalone" | "connected" {
  return getBackendUrl() ? "connected" : "standalone";
}

/**
 * Check if running in connected mode.
 * True when MAIN_BACKEND_URL is configured.
 */
export function isConnectedMode(): boolean {
  return !!getBackendUrl();
}

/**
 * Check if running in standalone mode (default).
 */
export function isStandaloneMode(): boolean {
  return !isConnectedMode();
}

/**
 * Get the session token for authenticating with backend.
 * This is the user's auth token, passed to studio when launching.
 * Returns undefined in standalone mode.
 */
export function getSessionToken(): string | undefined {
  if (!isConnectedMode()) return undefined;
  return process.env.SESSION_TOKEN;
}

/**
 * Get the connected organization id for studio->backend calls.
 * Comes from machine env (`VIVD_TENANT_ID`) with `TENANT_ID` as fallback.
 */
export function getConnectedOrganizationId(): string | undefined {
  if (!isConnectedMode()) return undefined;
  const raw = process.env.VIVD_TENANT_ID || process.env.TENANT_ID;
  const normalized = raw?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Get the unique studio instance ID.
 * Returns undefined in standalone mode.
 */
export function getStudioId(): string | undefined {
  if (!isConnectedMode()) return undefined;
  return process.env.STUDIO_ID;
}

/**
 * Get the full studio configuration.
 */
export function getStudioConfig(): StudioConfig {
  const mode = getStudioMode();
  return {
    mode,
    backendUrl: getBackendUrl(),
    sessionToken: getSessionToken(),
    studioId: getStudioId(),
  };
}

/**
 * Validate studio configuration.
 * Throws an error if connected mode is enabled but required variables are missing.
 */
export function validateStudioConfig(): void {
  if (!isConnectedMode()) return;

  const missing: string[] = [];

  // MAIN_BACKEND_URL is already set (that's how we detect connected mode)
  if (!process.env.SESSION_TOKEN) {
    missing.push("SESSION_TOKEN");
  }
  if (!process.env.STUDIO_ID) {
    missing.push("STUDIO_ID");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for connected studio mode: ${missing.join(", ")}`
    );
  }
}
