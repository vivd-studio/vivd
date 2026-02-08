import type { AuthSession } from "@vivd/shared/types";
import { localAuthProvider } from "./localAuthProvider";

/**
 * Get the current session from request headers.
 */
export async function getSession(headers: Headers): Promise<AuthSession | null> {
  return localAuthProvider.getSession(headers);
}
