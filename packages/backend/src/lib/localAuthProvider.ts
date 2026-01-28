/**
 * Local auth provider using Better Auth.
 * Used in self-hosted mode.
 */

import type { IAuthProvider, AuthSession } from "@vivd/shared/types";
import { auth } from "../auth";

class LocalAuthProvider implements IAuthProvider {
  async getSession(headers: Headers): Promise<AuthSession | null> {
    const session = await auth.api.getSession({ headers });
    return session as AuthSession | null;
  }
}

export const localAuthProvider = new LocalAuthProvider();
