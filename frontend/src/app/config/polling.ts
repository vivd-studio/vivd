/**
 * Centralized polling configuration for studio components.
 *
 * Use these constants instead of magic numbers to:
 * - Make polling behavior easy to tune
 * - Keep intervals consistent across components
 * - Document the rationale for each interval
 */

/**
 * Fast polling interval for when an agent task is actively running.
 * Used to keep UI responsive during streaming/waiting states.
 */
export const POLLING_ACTIVE = 2000;

/**
 * Standard background polling for status checks and git changes.
 * Balances responsiveness with server load.
 */
export const POLLING_BACKGROUND = 5000;

/**
 * Slower polling for idle state session status monitoring.
 * Only used when no active task is running but we want to detect
 * if a session becomes active (e.g., from another tab).
 */
export const POLLING_IDLE = 10000;

/**
 * Infrequent polling for expensive operations like usage limits.
 * These are fetched more often after task completion via manual refetch.
 */
export const POLLING_INFREQUENT = 30000;

/**
 * Dev server status polling while it's starting up.
 * Fast polling during the brief startup period.
 */
export const POLLING_DEV_SERVER_STARTING = 2000;

/**
 * Helper to determine polling interval based on active state.
 * Returns fast polling when active, false (disabled) when idle.
 */
export function getActivePollingInterval(isActive: boolean): number | false {
  return isActive ? POLLING_ACTIVE : false;
}

/**
 * Helper to determine polling interval for session status.
 * Returns fast polling when active, slow background polling when idle.
 */
export function getSessionStatusPollingInterval(isActive: boolean): number {
  return isActive ? POLLING_ACTIVE : POLLING_IDLE;
}
