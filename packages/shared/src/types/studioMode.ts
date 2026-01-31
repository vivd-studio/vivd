/**
 * Types for standalone studio mode configuration and usage reporting.
 */

/**
 * Usage report sent from standalone studio to main backend.
 */
export interface StudioUsageReport {
  /** OpenCode session ID */
  sessionId: string;
  /** Optional session title/description */
  sessionTitle?: string;
  /** Cost in dollars */
  cost: number;
  /** Token breakdown */
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  /** Part ID for idempotency */
  partId?: string;
  /** Workspace/project path */
  projectPath?: string;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Studio configuration for standalone/connected modes.
 */
export interface StudioConfig {
  /** Operating mode */
  mode: "standalone" | "connected";
  /** Main backend URL (required in connected mode) */
  backendUrl?: string;
  /** User's session token for authenticating with backend */
  sessionToken?: string;
  /** Unique identifier for this studio instance */
  studioId?: string;
}
