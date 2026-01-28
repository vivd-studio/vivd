/**
 * Mode detection for Vivd Studio dual-mode operation.
 *
 * - Self-hosted mode (default): Local Better Auth, env-based limits
 * - SaaS mode: Token validation and limits fetched from control plane
 */

export interface ModeConfig {
  mode: "self-hosted" | "saas";
  isSaas: boolean;
  controlPlaneUrl?: string;
  tenantId?: string;
}

/**
 * Check if running in SaaS mode.
 * SaaS mode is enabled when SAAS_MODE=true.
 */
export function isSaasMode(): boolean {
  return process.env.SAAS_MODE === "true";
}

/**
 * Check if running in self-hosted mode (default).
 */
export function isSelfHostedMode(): boolean {
  return !isSaasMode();
}

/**
 * Get the control plane URL for SaaS mode.
 * Returns undefined in self-hosted mode.
 */
export function getControlPlaneUrl(): string | undefined {
  if (!isSaasMode()) return undefined;
  return process.env.CONTROL_PLANE_URL;
}

/**
 * Get the tenant ID for this instance in SaaS mode.
 * Returns undefined in self-hosted mode.
 */
export function getTenantId(): string | undefined {
  if (!isSaasMode()) return undefined;
  return process.env.TENANT_ID;
}

/**
 * Get the control plane secret for authenticating with control plane.
 * Returns undefined in self-hosted mode.
 */
export function getControlPlaneSecret(): string | undefined {
  if (!isSaasMode()) return undefined;
  return process.env.CONTROL_PLANE_SECRET;
}

/**
 * Get the full mode configuration.
 */
export function getModeConfig(): ModeConfig {
  const saas = isSaasMode();
  return {
    mode: saas ? "saas" : "self-hosted",
    isSaas: saas,
    controlPlaneUrl: getControlPlaneUrl(),
    tenantId: getTenantId(),
  };
}

/**
 * Validate SaaS configuration.
 * Throws an error if SAAS_MODE is enabled but required variables are missing.
 */
export function validateSaasConfig(): void {
  if (!isSaasMode()) return;

  const missing: string[] = [];

  if (!process.env.CONTROL_PLANE_URL) {
    missing.push("CONTROL_PLANE_URL");
  }
  if (!process.env.TENANT_ID) {
    missing.push("TENANT_ID");
  }
  if (!process.env.CONTROL_PLANE_SECRET) {
    missing.push("CONTROL_PLANE_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for SaaS mode: ${missing.join(", ")}`
    );
  }
}
