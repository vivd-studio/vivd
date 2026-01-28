/**
 * Auth provider abstraction for dual-mode operation.
 *
 * Delegates to LocalAuthProvider (Better Auth) in self-hosted mode
 * or ControlPlaneAuthProvider in SaaS mode.
 */

import type { AuthSession } from "@vivd/shared/types";
import { isSaasMode } from "@vivd/shared/config";
import { localAuthProvider } from "./localAuthProvider";
import { controlPlaneAuthProvider } from "./controlPlaneClient";

/**
 * Get the current session from request headers.
 * Automatically uses the correct auth provider based on mode.
 */
export async function getSession(headers: Headers): Promise<AuthSession | null> {
  if (isSaasMode()) {
    return controlPlaneAuthProvider.getSession(headers);
  }
  return localAuthProvider.getSession(headers);
}
