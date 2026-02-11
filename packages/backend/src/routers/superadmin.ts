import { z } from "zod";
import crypto from "node:crypto";
import { router, superAdminProcedure } from "../trpc";
import { db } from "../db";
import {
  organization,
  organizationMember,
  projectMember,
  projectMeta,
  user as userTable,
} from "../db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "../auth";
import { limitsService } from "../services/LimitsService";
import { usageService } from "../services/UsageService";

function headersFromNode(reqHeaders: Record<string, unknown>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (typeof value === "string") {
      headers.append(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") headers.append(key, entry);
      }
    }
  }
  return headers;
}

const organizationIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Invalid organization slug");

const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "client_editor",
]);

const orgMemberRoleSchema = z.enum(["owner", "admin", "member", "client_editor"]);

function getGlobalUserRoleForOrganizationRole(
  _role: z.infer<typeof organizationRoleSchema>,
): "user" {
  return "user";
}

const limitsPatchSchema = z
  .object({
    dailyCreditLimit: z.number().nonnegative().optional(),
    weeklyCreditLimit: z.number().nonnegative().optional(),
    monthlyCreditLimit: z.number().nonnegative().optional(),
    imageGenPerMonth: z.number().int().nonnegative().optional(),
    warningThreshold: z.number().min(0).max(1).optional(),
    maxProjects: z.number().int().nonnegative().optional(),
  })
  .strict();

const authCreateUserResponseSchema = z
  .object({
    user: z.object({
      id: z.string().min(1),
    }),
  })
  .passthrough();

export const superAdminRouter = router({
  lookupUserByEmail: superAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .query(async ({ input }) => {
      const normalizedEmail = input.email.toLowerCase();
      const existingUser = await db.query.user.findFirst({
        where: eq(userTable.email, normalizedEmail),
        columns: { id: true },
      });
      return { exists: !!existingUser };
    }),

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

      const maxProjectsRaw = (org?.limits as { maxProjects?: unknown } | null | undefined)
        ?.maxProjects;
      const maxProjects =
        typeof maxProjectsRaw === "number" && Number.isFinite(maxProjectsRaw) && maxProjectsRaw > 0
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
        slug: organizationIdSchema,
        name: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.slug === "default") {
        throw new Error('Organization slug "default" is reserved');
      }

      await db.insert(organization).values({
        id: input.slug,
        slug: input.slug,
        name: input.name,
        status: "active",
        limits: {
          dailyCreditLimit: 1000,
          weeklyCreditLimit: 2500,
          monthlyCreditLimit: 5000,
          imageGenPerMonth: 25,
          warningThreshold: 0.8,
        },
        githubRepoPrefix: input.slug,
      });

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

  listOrganizationMembers: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const members = await db.query.organizationMember.findMany({
        where: eq(organizationMember.organizationId, input.organizationId),
        with: {
          user: true,
        },
      });

      const userIds = members.map((m) => m.userId);
      const assignments =
        userIds.length > 0
          ? await db.query.projectMember.findMany({
              where: and(
                eq(projectMember.organizationId, input.organizationId),
                inArray(projectMember.userId, userIds),
              ),
              columns: { userId: true, projectSlug: true },
            })
          : [];
      const projectByUserId = new Map(assignments.map((a) => [a.userId, a.projectSlug]));

      return {
        members: members.map((m) => ({
          id: m.id,
          organizationId: m.organizationId,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt,
          assignedProjectSlug: projectByUserId.get(m.userId) ?? null,
          user: {
            id: m.user.id,
            email: m.user.email,
            name: m.user.name,
            role: m.user.role,
            createdAt: m.user.createdAt,
            updatedAt: m.user.updatedAt,
          },
        })),
      };
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
        projects: projects.map((p) => ({
          slug: p.slug,
          title: p.title,
          updatedAt: p.updatedAt,
        })),
      };
    }),

  updateOrganizationMemberRole: superAdminProcedure
    .input(
      z
        .object({
          organizationId: organizationIdSchema,
          userId: z.string().min(1),
          role: orgMemberRoleSchema,
          projectSlug: z.string().min(1).optional(),
        })
        .refine((data) => (data.role === "client_editor" ? !!data.projectSlug : true), {
          message: "Project is required for client editor accounts",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new Error("You cannot change your own role");
      }

      await db.transaction(async (tx) => {
        const membership = await tx.query.organizationMember.findFirst({
          where: and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.userId, input.userId),
          ),
          columns: { role: true },
        });

        if (!membership) {
          throw new Error("Member not found");
        }

        if (input.role === "client_editor" && input.projectSlug) {
          const project = await tx.query.projectMeta.findFirst({
            where: and(
              eq(projectMeta.organizationId, input.organizationId),
              eq(projectMeta.slug, input.projectSlug),
            ),
            columns: { slug: true },
          });
          if (!project) {
            throw new Error("Project not found");
          }
        }

        await tx
          .update(organizationMember)
          .set({ role: input.role })
          .where(
            and(
              eq(organizationMember.organizationId, input.organizationId),
              eq(organizationMember.userId, input.userId),
            ),
          );

        const globalRole = getGlobalUserRoleForOrganizationRole(input.role);
        await tx.update(userTable).set({ role: globalRole }).where(eq(userTable.id, input.userId));

        if (input.role === "client_editor" && input.projectSlug) {
          await tx
            .insert(projectMember)
            .values({
              id: crypto.randomUUID(),
              organizationId: input.organizationId,
              userId: input.userId,
              projectSlug: input.projectSlug,
            })
            .onConflictDoUpdate({
              target: [projectMember.organizationId, projectMember.userId],
              set: { projectSlug: input.projectSlug },
            });
        } else {
          await tx
            .delete(projectMember)
            .where(
              and(
                eq(projectMember.organizationId, input.organizationId),
                eq(projectMember.userId, input.userId),
              ),
            );
        }
      });

      return { success: true };
    }),

  removeOrganizationMember: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new Error("You cannot remove yourself");
      }

      const membership = await db.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, input.organizationId),
          eq(organizationMember.userId, input.userId),
        ),
        columns: { role: true },
      });

      if (!membership) {
        return { success: true };
      }

      await db
        .delete(projectMember)
        .where(
          and(
            eq(projectMember.organizationId, input.organizationId),
            eq(projectMember.userId, input.userId),
          ),
        );

      await db
        .delete(organizationMember)
        .where(
          and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.userId, input.userId),
          ),
        );

      return { success: true };
    }),

  createOrganizationUser: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        email: z.string().email(),
        name: z.string().min(1).max(128).optional(),
        password: z.string().min(8).optional(),
        userRole: z
          .enum(["super_admin", "user"])
          .optional(),
        organizationRole: organizationRoleSchema.optional().default("admin"),
        projectSlug: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const headers = headersFromNode(ctx.req.headers as Record<string, unknown>);
      const normalizedEmail = input.email.toLowerCase();

      if (input.organizationRole === "client_editor" && !input.projectSlug) {
        throw new Error("Project is required for client editor accounts");
      }

      const userRole =
        input.userRole ??
        getGlobalUserRoleForOrganizationRole(input.organizationRole);

      const existingUser = await db.query.user.findFirst({
        where: eq(userTable.email, normalizedEmail),
        columns: { id: true, role: true },
      });

      if (input.organizationRole === "client_editor" && input.projectSlug) {
        const project = await db.query.projectMeta.findFirst({
          where: and(
            eq(projectMeta.organizationId, input.organizationId),
            eq(projectMeta.slug, input.projectSlug),
          ),
          columns: { slug: true },
        });
        if (!project) {
          throw new Error("Project not found");
        }
      }

      if (existingUser) {
        const existingMembership = await db.query.organizationMember.findFirst({
          where: and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.userId, existingUser.id),
          ),
          columns: { id: true },
        });
        if (existingMembership) {
          throw new Error("User is already a member of this organization");
        }

        await db.transaction(async (tx) => {
          if (input.userRole) {
            await tx
              .update(userTable)
              .set({ role: userRole })
              .where(eq(userTable.id, existingUser.id));
          }

          await tx
            .insert(organizationMember)
            .values({
              id: crypto.randomUUID(),
              organizationId: input.organizationId,
              userId: existingUser.id,
              role: input.organizationRole,
            })
            .onConflictDoNothing({
              target: [organizationMember.organizationId, organizationMember.userId],
            });

          if (input.organizationRole === "client_editor" && input.projectSlug) {
            await tx
              .insert(projectMember)
              .values({
                id: crypto.randomUUID(),
                organizationId: input.organizationId,
                userId: existingUser.id,
                projectSlug: input.projectSlug,
              })
              .onConflictDoUpdate({
                target: [projectMember.organizationId, projectMember.userId],
                set: { projectSlug: input.projectSlug },
              });
          }
        });

        return { success: true, userId: existingUser.id, created: false };
      }

      if (!input.name || !input.password) {
        throw new Error("Name and password are required to create a new user");
      }

      const created = await auth.api.createUser({
        headers,
        body: {
          email: normalizedEmail,
          password: input.password,
          name: input.name,
          role: userRole,
        },
      });

      const parsedCreateUser = authCreateUserResponseSchema.safeParse(created);
      if (!parsedCreateUser.success) {
        throw new Error("Failed to create user");
      }
      const createdUserId = parsedCreateUser.data.user.id;

      await db.transaction(async (tx) => {
        await tx
          .insert(organizationMember)
          .values({
            id: crypto.randomUUID(),
            organizationId: input.organizationId,
            userId: createdUserId,
            role: input.organizationRole,
          })
          .onConflictDoNothing({
            target: [organizationMember.organizationId, organizationMember.userId],
          });

        if (input.organizationRole === "client_editor" && input.projectSlug) {
          await tx
            .insert(projectMember)
            .values({
              id: crypto.randomUUID(),
              organizationId: input.organizationId,
              userId: createdUserId,
              projectSlug: input.projectSlug,
            })
            .onConflictDoUpdate({
              target: [projectMember.organizationId, projectMember.userId],
              set: { projectSlug: input.projectSlug },
            });
        }
      });

      return { success: true, userId: createdUserId, created: true };
    }),
});
