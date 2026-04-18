import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { superAdminProcedure } from "../trpc";
import { db } from "../db";
import {
  organization,
  organizationMember,
  projectMember,
  projectMeta,
  user as userTable,
} from "../db/schema";
import { auth } from "../auth";
import { limitsService } from "../services/usage/LimitsService";
import { usageService } from "../services/usage/UsageService";
import {
  domainService,
  validateOrganizationSlug,
} from "../services/publish/DomainService";
import { publishService } from "../services/publish/PublishService";
import { installProfileService } from "../services/system/InstallProfileService";
import {
  organizationIdSchema,
  organizationSlugSchema,
} from "../lib/organizationIdentifiers";
import {
  getOrganizationInvitationStorageErrorMessage,
  organizationInvitationService,
} from "../services/auth/OrganizationInvitationService";
import { controlPlaneRateLimitService } from "../services/system/ControlPlaneRateLimitService";

const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "client_editor",
]);
const orgMemberRoleSchema = z.enum(["owner", "admin", "member", "client_editor"]);
const domainUsageSchema = z.enum(["tenant_host", "publish_target"]);
const domainTypeSchema = z.enum(["managed_subdomain", "custom_domain"]);
const domainStatusSchema = z.enum(["active", "disabled", "pending_verification"]);

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

function getGlobalUserRoleForOrganizationRole(
  _role: z.infer<typeof organizationRoleSchema>,
): "user" {
  return "user";
}

async function enforceInviteRateLimit(input: {
  organizationId: string | null;
  requestIp: string | null;
  userId: string | null;
  res: { setHeader(name: string, value: string): unknown };
}) {
  const decision = await controlPlaneRateLimitService.checkAction({
    action: "auth_mutation",
    organizationId: input.organizationId,
    requestIp: input.requestIp,
    userId: input.userId,
  });

  if (!decision.allowed) {
    if (decision.retryAfterSeconds > 0) {
      input.res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    }
    throw new Error("Invite request budget exceeded. Please wait a moment and retry.");
  }
}

function getOrganizationInvitationErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return (
    getOrganizationInvitationStorageErrorMessage(error) ??
    (error instanceof Error ? error.message : fallback)
  );
}

export const organizationSuperAdminProcedures = {
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

      const userIds = members.map((member) => member.userId);
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
      const projectByUserId = new Map(assignments.map((assignment) => [assignment.userId, assignment.projectSlug]));

      return {
        members: members.map((member) => ({
          id: member.id,
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          assignedProjectSlug: projectByUserId.get(member.userId) ?? null,
          user: {
            id: member.user.id,
            email: member.user.email,
            name: member.user.name,
            role: member.user.role,
            createdAt: member.user.createdAt,
            updatedAt: member.user.updatedAt,
          },
        })),
      };
    }),

  listOrganizationInvitations: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      try {
        return await organizationInvitationService.listOrganizationInvitations(
          input.organizationId,
        );
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to load invitations",
          ),
        );
      }
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

  listOrganizationDomains: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
      }),
    )
    .query(async ({ input }) => {
      const domains = await domainService.listOrganizationDomains(input.organizationId);
      return { domains };
    }),

  addOrganizationDomain: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        domain: z.string().min(1),
        usage: domainUsageSchema,
        type: domainTypeSchema,
        status: domainStatusSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await domainService.addOrganizationDomain({
        organizationId: input.organizationId,
        rawDomain: input.domain,
        usage: input.usage,
        type: input.type,
        status: input.status,
        createdById: ctx.session.user.id,
      });
      await publishService.syncGeneratedCaddyConfigs();

      return {
        success: true,
        domainId: result.id,
        domain: result.domain,
        created: result.created,
      };
    }),

  setOrganizationDomainStatus: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
        status: domainStatusSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await domainService.setDomainStatus(input.domainId, input.status);
      await publishService.syncGeneratedCaddyConfigs();
      return { success: true };
    }),

  setOrganizationDomainUsage: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
        usage: domainUsageSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await domainService.setDomainUsage(input.domainId, input.usage);
      await publishService.syncGeneratedCaddyConfigs();
      return { success: true };
    }),

  startDomainVerification: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const data = await domainService.startDomainVerification(input.domainId);
      return {
        success: true,
        verification: data,
      };
    }),

  checkDomainVerification: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await domainService.checkDomainVerification(input.domainId);
      return {
        success: result.verified,
        status: result.status,
        verification: result.verification,
      };
    }),

  removeOrganizationDomain: superAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await domainService.removeOrganizationDomain(input.domainId);
      await publishService.syncGeneratedCaddyConfigs();
      return {
        success: true,
        removed: result.removed,
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
        await tx
          .update(userTable)
          .set({ role: globalRole })
          .where(eq(userTable.id, input.userId));

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

  inviteOrganizationMember: superAdminProcedure
    .input(
      z
        .object({
          organizationId: organizationIdSchema,
          email: z.string().email(),
          name: z.string().min(1).max(128).optional(),
          organizationRole: organizationRoleSchema.optional().default("admin"),
          projectSlug: z.string().min(1).optional(),
        })
        .refine(
          (data) =>
            data.organizationRole === "client_editor" ? !!data.projectSlug : true,
          {
            message: "Project is required for client editor accounts",
            path: ["projectSlug"],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: input.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.inviteMember({
          organizationId: input.organizationId,
          email: input.email,
          inviteeName: input.name,
          role: input.organizationRole,
          projectSlug: input.projectSlug,
          inviterId: ctx.session.user.id,
        });
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to send invitation",
          ),
        );
      }
    }),

  resendOrganizationInvitation: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: input.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.resendInvite({
          organizationId: input.organizationId,
          invitationId: input.invitationId,
        });
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to resend invitation",
          ),
        );
      }
    }),

  cancelOrganizationInvitation: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        await organizationInvitationService.cancelInvite({
          organizationId: input.organizationId,
          invitationId: input.invitationId,
        });
        return { success: true };
      } catch (error) {
        throw new Error(
          getOrganizationInvitationErrorMessage(
            error,
            "Failed to cancel invitation",
          ),
        );
      }
    }),

  createOrganizationUser: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        email: z.string().email(),
        name: z.string().min(1).max(128).optional(),
        password: z.string().min(8).optional(),
        userRole: z.enum(["super_admin", "user"]).optional(),
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
};
