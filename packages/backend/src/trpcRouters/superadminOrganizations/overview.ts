import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { organization, organizationMember, projectMeta } from "../../db/schema";
import {
  organizationIdSchema,
  organizationSlugSchema,
} from "../../lib/organizationIdentifiers";
import {
  domainService,
  validateOrganizationSlug,
} from "../../services/publish/DomainService";
import { publishService } from "../../services/publish/PublishService";
import { installProfileService } from "../../services/system/InstallProfileService";
import { limitsService } from "../../services/usage/LimitsService";
import { usageService } from "../../services/usage/UsageService";
import { superAdminProcedure } from "../../trpc";
import { limitsPatchSchema } from "./shared";

export const organizationOverviewSuperAdminProcedures = {
  listOrganizations: superAdminProcedure.query(async () => {
    const rows = await db
      .select({
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        status: organization.status,
        limits: organization.limits,
        githubRepoPrefix: organization.githubRepoPrefix,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        memberCount: sql<number>`count(${organizationMember.userId})`,
      })
      .from(organization)
      .leftJoin(
        organizationMember,
        eq(organizationMember.organizationId, organization.id),
      )
      .groupBy(organization.id);

    return {
      organizations: rows.map((row) => ({
        ...row,
        memberCount: Number(row.memberCount) || 0,
      })),
    };
  }),

  getOrganizationUsage: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const instancePolicy = await installProfileService.resolvePolicy();
      const [limits, currentUsage, projectCountRow, org] = await Promise.all([
        limitsService.checkLimits(input.organizationId),
        usageService.getCurrentUsage(input.organizationId),
        db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(projectMeta)
          .where(eq(projectMeta.organizationId, input.organizationId)),
        db.query.organization.findFirst({
          where: eq(organization.id, input.organizationId),
          columns: { limits: true },
        }),
      ]);

      const maxProjectsRaw = instancePolicy.capabilities.orgLimitOverrides
        ? (org?.limits as { maxProjects?: unknown } | null | undefined)?.maxProjects
        : instancePolicy.limitDefaults.maxProjects;
      const maxProjects =
        typeof maxProjectsRaw === "number" &&
        Number.isFinite(maxProjectsRaw) &&
        maxProjectsRaw > 0
          ? Math.floor(maxProjectsRaw)
          : null;
      const projectCount = Number(projectCountRow?.[0]?.count ?? 0);

      return {
        limits,
        currentUsage,
        projectCount,
        maxProjects,
      };
    }),

  createOrganization: superAdminProcedure
    .input(
      z.object({
        slug: organizationSlugSchema,
        name: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      const slugValidation = validateOrganizationSlug(input.slug);
      if (!slugValidation.valid) {
        throw new Error(slugValidation.error || "Invalid organization slug");
      }

      await db.insert(organization).values({
        id: input.slug,
        slug: input.slug,
        name: input.name,
        status: "active",
        limits: {},
        githubRepoPrefix: input.slug,
      });

      await domainService.ensureManagedTenantDomainForOrganization({
        organizationId: input.slug,
        organizationSlug: input.slug,
      });
      await publishService.syncGeneratedCaddyConfigs();

      return { success: true, organizationId: input.slug };
    }),

  setOrganizationStatus: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        status: z.enum(["active", "suspended"]),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(organization)
        .set({ status: input.status })
        .where(eq(organization.id, input.organizationId));
      return { success: true };
    }),

  patchOrganizationLimits: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        limits: limitsPatchSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await db.query.organization.findFirst({
        where: eq(organization.id, input.organizationId),
        columns: { limits: true },
      });
      const current =
        existing?.limits && typeof existing.limits === "object" ? existing.limits : {};

      await db
        .update(organization)
        .set({
          limits: {
            ...(current as Record<string, unknown>),
            ...input.limits,
          },
        })
        .where(eq(organization.id, input.organizationId));

      return { success: true };
    }),

  setOrganizationGitHubRepoPrefix: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        githubRepoPrefix: z.string().max(64),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(organization)
        .set({ githubRepoPrefix: input.githubRepoPrefix.trim() })
        .where(eq(organization.id, input.organizationId));

      return { success: true };
    }),

  listOrganizationProjects: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const projects = await db.query.projectMeta.findMany({
        where: eq(projectMeta.organizationId, input.organizationId),
        columns: {
          slug: true,
          title: true,
          updatedAt: true,
        },
        orderBy: (table, { desc }) => [desc(table.updatedAt)],
      });

      return {
        projects: projects.map((project) => ({
          slug: project.slug,
          title: project.title,
          updatedAt: project.updatedAt,
        })),
      };
    }),

  deleteOrganization: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .mutation(async ({ input }) => {
      if (input.organizationId === "default") {
        throw new Error("The default organization cannot be deleted");
      }
      await db
        .delete(organization)
        .where(eq(organization.id, input.organizationId));
      return { success: true };
    }),

  updateOrganizationName: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        name: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, input.organizationId));
      return { success: true };
    }),
};
