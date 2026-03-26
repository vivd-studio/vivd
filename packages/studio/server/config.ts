/**
 * Studio server configuration
 */

import { DEFAULT_STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS } from "../shared/opencodeContextPolicy.js";

// Quality setting for WebP image conversions (1-100)
export const WEBP_QUALITY = 85;
export const STUDIO_WORKING_IMAGE_UPLOAD_WEBP_QUALITY = 90;
export const STUDIO_WORKING_IMAGE_UPLOAD_MAX_DIMENSION = 3840;

export function getStudioOpencodeSoftContextLimitTokens(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = (env.STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS || "").trim();
  if (!raw) {
    return DEFAULT_STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STUDIO_OPENCODE_SOFT_CONTEXT_LIMIT_TOKENS;
  }

  return parsed;
}

export function getStudioRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    softContextLimitTokens: getStudioOpencodeSoftContextLimitTokens(env),
  };
}
