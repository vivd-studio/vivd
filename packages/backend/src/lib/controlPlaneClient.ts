/**
 * Control Plane API client for SaaS mode.
 * Stub implementation - will be fully implemented in Phase 2.
 */

import type { IAuthProvider, AuthSession, LimitsConfig } from "@vivd/shared/types";
import {
  getControlPlaneUrl,
  getTenantId,
  getControlPlaneSecret,
} from "@vivd/shared/config";

const LIMITS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedLimits {
  config: LimitsConfig;
  fetchedAt: number;
}

let limitsCache: CachedLimits | null = null;

/**
 * Control plane auth provider - validates tokens against control plane.
 * Stub implementation for Phase 1.
 */
class ControlPlaneAuthProvider implements IAuthProvider {
  async getSession(headers: Headers): Promise<AuthSession | null> {
    // TODO: Phase 2 - Implement control plane token validation
    // For now, this is a stub that returns null (no session)
    // In Phase 2, this will:
    // 1. Extract bearer token from Authorization header
    // 2. Validate token against control plane API
    // 3. Return session with user info from control plane

    void headers;

    // Stub: always return null for now
    console.warn(
      "[ControlPlane] Auth provider called but not yet implemented. Returning null session."
    );
    return null;
  }
}

export const controlPlaneAuthProvider = new ControlPlaneAuthProvider();

/**
 * Fetch limits configuration from control plane with caching.
 * Returns cached value if less than 5 minutes old.
 * Falls back to env defaults if control plane is unavailable.
 */
export async function getControlPlaneLimits(): Promise<LimitsConfig | null> {
  // Check cache first
  if (limitsCache && Date.now() - limitsCache.fetchedAt < LIMITS_CACHE_TTL_MS) {
    return limitsCache.config;
  }

  const controlPlaneUrl = getControlPlaneUrl();
  const tenantId = getTenantId();
  const secret = getControlPlaneSecret();

  if (!controlPlaneUrl || !tenantId || !secret) {
    console.warn("[ControlPlane] Missing configuration, cannot fetch limits");
    return null;
  }

  try {
    // TODO: Phase 2 - Implement actual API call
    // For now, return null to fall back to env defaults
    console.warn(
      "[ControlPlane] Limits fetch not yet implemented. Using env defaults."
    );
    return null;
  } catch (error) {
    console.error("[ControlPlane] Failed to fetch limits:", error);
    return null;
  }
}

/**
 * Clear the limits cache.
 * Useful for testing or when limits need to be refreshed immediately.
 */
export function clearLimitsCache(): void {
  limitsCache = null;
}
