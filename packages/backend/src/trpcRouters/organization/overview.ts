import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  organization,
  organizationMember,
  session as sessionTable,
} from "../../db/schema";
import { organizationIdSchema } from "../../lib/organizationIdentifiers";
import { domainService } from "../../services/publish/DomainService";
import { installProfileService } from "../../services/system/InstallProfileService";
import {
  orgAdminProcedure,
  orgProcedure,
  protectedProcedure,
} from "../../trpc";

export const organizationOverviewProcedures = {
  listMyOrganizations: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        status: organization.status,
        role: organizationMember.role,
        createdAt: organizationMember.createdAt,
      })
      .from(organizationMember)
      .innerJoin(organization, eq(organization.id, organizationMember.organizationId))
      .where(eq(organizationMember.userId, ctx.session.user.id))
      .orderBy(asc(organization.name));

    const tenantHostByOrganizationId = await domainService.getTenantHostsForOrganizations(
      rows.map((row) => row.id),
      {
        preferredTenantBaseDomain: domainService.inferTenantBaseDomainFromHost(
          ctx.requestDomain,
        ),
      },
    );

    return {
      organizations: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        role: row.role,
        createdAt: row.createdAt,
        isActive: row.id === ctx.organizationId,
        tenantHost: tenantHostByOrganizationId.get(row.id) ?? null,
      })),
    };
  }),

  setActiveOrganization: protectedProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const instancePolicy = await installProfileService.resolvePolicy();
      if (!instancePolicy.capabilities.multiOrg) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization switching is disabled for this install profile",
        });
      }

      if (!ctx.canSelectOrganization) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization selection is pinned to this domain",
        });
      }

      const org = await db.query.organization.findFirst({
        where: eq(organization.id, input.organizationId),
        columns: { id: true, slug: true, status: true },
      });
      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      if (ctx.session.user.role !== "super_admin") {
        if (org.status === "suspended") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Organization is suspended",
          });
        }

        const membership = await db.query.organizationMember.findFirst({
          where: and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.userId, ctx.session.user.id),
          ),
          columns: { id: true },
        });
        if (!membership) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You are not a member of this organization",
          });
        }
      }

      await domainService.ensureManagedTenantDomainForOrganization({
        organizationId: org.id,
        organizationSlug: org.slug,
      });

      await db
        .update(sessionTable)
        .set({ activeOrganizationId: input.organizationId })
        .where(eq(sessionTable.id, ctx.session.session.id));

      const tenantHosts = await domainService.getTenantHostsForOrganizations([org.id], {
        preferredTenantBaseDomain: domainService.inferTenantBaseDomainFromHost(
          ctx.requestDomain,
        ),
      });
      const tenantHost = tenantHosts.get(org.id) ?? null;

      return { success: true, tenantHost: tenantHost ?? null };
    }),

  updateOrganizationName: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;

      if (
        ctx.organizationRole !== "owner" &&
        ctx.session.user.role !== "super_admin"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization owners can rename the organization",
        });
      }

      await db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, organizationId));

      return { success: true };
    }),

  getMyMembership: orgProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    return {
      organizationId,
      organizationRole: ctx.organizationRole,
      isOrganizationAdmin:
        ctx.session.user.role === "super_admin" ||
        ctx.organizationRole === "owner" ||
        ctx.organizationRole === "admin",
    };
  }),

  getMyOrganization: orgProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: {
        id: true,
        slug: true,
        name: true,
        status: true,
        limits: true,
        githubRepoPrefix: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    return { organization: org };
  }),
};
