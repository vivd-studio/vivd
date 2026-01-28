/**
 * Shared limits types for dual-mode operation.
 */

export interface LimitsConfig {
  /** Daily credit limit (1 credit = 1 cent). 0 = unlimited. */
  dailyCreditLimit: number;
  /** Weekly credit limit. 0 = unlimited. */
  weeklyCreditLimit: number;
  /** Monthly credit limit. 0 = unlimited. */
  monthlyCreditLimit: number;
  /** Monthly image generation limit. 0 = unlimited. */
  imageGenPerMonth: number;
  /** Warning threshold (0-1). Show warning when usage exceeds this percentage. */
  warningThreshold: number;
}

/**
 * Organization limits from control plane (SaaS mode).
 */
export interface OrganizationLimits extends LimitsConfig {
  organizationId: string;
  planName: string;
  planTier: "free" | "starter" | "pro" | "enterprise";
  validUntil?: Date;
}
