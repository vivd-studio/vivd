import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { organization, organizationMember } from "../db/schema";

export type OrganizationAccessCheck =
  | {
      ok: true;
      isSuperAdmin: boolean;
      organizationRole: string | null;
    }
  | {
      ok: false;
      reason:
        | "unauthenticated"
        | "no_organization"
        | "organization_not_found"
        | "organization_suspended"
        | "not_a_member";
    };

export async function checkOrganizationAccess(options: {
  session: { user: { id: string; role?: string | null } } | null;
  organizationId: string | null;
}): Promise<OrganizationAccessCheck> {
  if (!options.session) {
    return { ok: false, reason: "unauthenticated" };
  }

  const organizationId = options.organizationId?.trim() || null;
  if (!organizationId) {
    return { ok: false, reason: "no_organization" };
  }

  const userRole = options.session.user.role ?? "user";
  const isSuperAdmin = userRole === "super_admin";
  if (isSuperAdmin) {
    return { ok: true, isSuperAdmin: true, organizationRole: null };
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: {
      status: true,
    },
  });

  if (!org) {
    return { ok: false, reason: "organization_not_found" };
  }

  if (org.status === "suspended") {
    return { ok: false, reason: "organization_suspended" };
  }

  const membership = await db.query.organizationMember.findFirst({
    where: and(
      eq(organizationMember.organizationId, organizationId),
      eq(organizationMember.userId, options.session.user.id),
    ),
    columns: { role: true },
  });

  if (!membership) {
    return { ok: false, reason: "not_a_member" };
  }

  return {
    ok: true,
    isSuperAdmin: false,
    organizationRole: membership.role,
  };
}

