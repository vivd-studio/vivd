import { authClient } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";

export type UserRole = "super_admin" | "user" | "admin" | "client_editor";
export type OrganizationRole = "owner" | "admin" | "member" | "client_editor" | null;

/**
 * Hook for checking user permissions based on their role.
 *
 * In multi-tenant mode:
 * - Global role (`session.user.role`) is only for super-admin capabilities.
 * - Tenant capabilities come from organization membership role.
 */
export function usePermissions() {
  const { data: session } = authClient.useSession();
  const { data: membership } = trpc.organization.getMyMembership.useQuery(undefined, {
    enabled: !!session && session.user.role !== "super_admin",
  });
  const role = (session?.user?.role ?? "user") as UserRole;
  const organizationRole = (membership?.organizationRole ?? null) as OrganizationRole;
  const isSuperAdmin = role === "super_admin";
  const isOrgAdmin =
    organizationRole === "owner" || organizationRole === "admin";
  const isClientEditor = organizationRole === "client_editor";
  const isAdmin = isSuperAdmin || isOrgAdmin;

  return {
    role,
    organizationRole,
    isSuperAdmin,
    isOrgAdmin,
    isAdmin,
    isUser: !isSuperAdmin && !isClientEditor,
    isClientEditor,

    // Feature gates
    // Client editors stay project-scoped through route/backend guards, but can use
    // the same AI editing surface inside that assigned project.
    canUseAgent: true,
    canUseAiImages: true,
    canManageProjects: !isClientEditor,
    canManageUsers: isAdmin,
    canAccessMaintenance: isSuperAdmin,
  };
}
