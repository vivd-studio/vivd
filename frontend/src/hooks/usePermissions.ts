import { authClient } from "@/lib/auth-client";

export type UserRole = "admin" | "user" | "client_editor";

/**
 * Hook for checking user permissions based on their role.
 *
 * Role Hierarchy:
 * - admin: Full access including user management and system maintenance
 * - user: Team member with AI features but no admin access
 * - client_editor: Customer with access only to assigned project, no AI features
 */
export function usePermissions() {
  const { data: session } = authClient.useSession();
  const role = (session?.user?.role ?? "user") as UserRole;

  return {
    role,
    isAdmin: role === "admin",
    isUser: role === "user",
    isClientEditor: role === "client_editor",

    // Feature gates
    canUseAgent: role !== "client_editor",
    canUseAiImages: role !== "client_editor",
    canManageProjects: role !== "client_editor",
    canManageUsers: role === "admin",
    canAccessMaintenance: role === "admin",
  };
}
