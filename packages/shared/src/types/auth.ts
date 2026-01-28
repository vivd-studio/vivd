/**
 * Shared auth types for dual-mode operation.
 */

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  role: "admin" | "user" | "client_editor";
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSession {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  user: AuthUser;
}

/**
 * Auth provider interface for dual-mode authentication.
 * Implemented by LocalAuthProvider (Better Auth) and ControlPlaneAuthProvider.
 */
export interface IAuthProvider {
  /**
   * Get the current session from request headers.
   * Returns null if no valid session exists.
   */
  getSession(headers: Headers): Promise<AuthSession | null>;
}
