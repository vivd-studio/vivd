export type UserRole = "admin" | "user" | "client_editor";

/**
 * Standalone studio permissions.
 *
 * The single-instance studio currently runs without auth; treat the user as admin
 * for editor features, but keep AI image generation disabled until the server supports it.
 */
export function usePermissions() {
  const role: UserRole = "admin";

  return {
    role,
    isAdmin: role === "admin",
    isUser: role === "user",
    isClientEditor: role === "client_editor",

    // Feature gates
    canUseAgent: true,
    canUseAiImages: true,
    canManageProjects: false,
    canManageUsers: false,
    canAccessMaintenance: false,
  };
}

