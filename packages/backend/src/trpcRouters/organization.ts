import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { z } from "zod";
import {
  router,
  orgAdminProcedure,
  orgProcedure,
  protectedProcedure,
  publicProcedure,
} from "../trpc";
import { db } from "../db";
import {
  organization,
  organizationMember,
  projectPluginInstance,
  projectMember,
  projectMeta,
  publishedSite,
  session as sessionTable,
  user as userTable,
} from "../db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { auth } from "../auth";
import { domainService } from "../services/publish/DomainService";
import { organizationIdSchema } from "../lib/organizationIdentifiers";
import { installProfileService } from "../services/system/InstallProfileService";
import {
  PLUGIN_IDS,
  listPluginCatalogEntries,
  type PluginId,
} from "../services/plugins/catalog";
import {
  buildOrganizationPluginProjectSummaries,
} from "../services/plugins/integrationHooks";
import type {
  OrganizationProjectPluginItem,
  OrganizationPluginIssue,
  PluginSurfaceBadge,
} from "../services/plugins/surfaceTypes";
import {
  getOrganizationInvitationStorageErrorMessage,
  organizationInvitationService,
} from "../services/auth/OrganizationInvitationService";
import { controlPlaneRateLimitService } from "../services/system/ControlPlaneRateLimitService";

const memberRoleSchema = z.enum(["admin", "member", "client_editor"]);

function getGlobalUserRoleForMemberRole(
  _role: z.infer<typeof memberRoleSchema>,
): "user" {
  return "user";
}

type PluginInstanceStatus = "enabled" | "disabled" | "not_installed";

function toPluginInstanceStatus(raw: string | null | undefined): PluginInstanceStatus {
  if (!raw) return "not_installed";
  if (raw === "enabled") return "enabled";
  return "disabled";
}

async function enforceInviteRateLimit(input: {
  organizationId: string | null;
  requestIp: string | null;
  userId: string | null;
  res: { setHeader(name: string, value: string): unknown };
}) {
  const decision = await controlPlaneRateLimitService.checkAction({
    action: "auth",
    organizationId: input.organizationId,
    requestIp: input.requestIp,
    userId: input.userId,
  });

  if (!decision.allowed) {
    if (decision.retryAfterSeconds > 0) {
      input.res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    }
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Invite request budget exceeded. Please wait a moment and retry.",
    });
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

export const organizationRouter = router({
  lookupUserByEmail: orgAdminProcedure
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
        preferredTenantBaseDomain: domainService.inferTenantBaseDomainFromHost(ctx.requestDomain),
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
        preferredTenantBaseDomain: domainService.inferTenantBaseDomainFromHost(ctx.requestDomain),
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

  pluginsOverview: orgAdminProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    const pluginCatalog = listPluginCatalogEntries();
    const projects = await db.query.projectMeta.findMany({
      where: eq(projectMeta.organizationId, organizationId),
      columns: {
        slug: true,
        title: true,
        updatedAt: true,
      },
      orderBy: (table, { desc, asc: ascending }) => [desc(table.updatedAt), ascending(table.slug)],
    });

    if (projects.length === 0) {
      return { rows: [] };
    }

    const projectSlugs = projects.map((project) => project.slug);

    const [pluginInstances, publishedRows] =
      await Promise.all([
        db.query.projectPluginInstance.findMany({
          where: and(
            eq(projectPluginInstance.organizationId, organizationId),
            inArray(projectPluginInstance.projectSlug, projectSlugs),
            inArray(projectPluginInstance.pluginId, PLUGIN_IDS),
          ),
          columns: {
            id: true,
            projectSlug: true,
            pluginId: true,
            status: true,
            configJson: true,
            updatedAt: true,
          },
        }),
        db.query.publishedSite.findMany({
          where: and(
            eq(publishedSite.organizationId, organizationId),
            inArray(publishedSite.projectSlug, projectSlugs),
          ),
          columns: {
            projectSlug: true,
            domain: true,
            publishedAt: true,
          },
        }),
      ]);

    const instanceByProjectPluginId = new Map<
      string,
      {
        id: string;
        status: string;
        configJson: unknown;
        updatedAt: Date;
      }
    >();
    for (const pluginInstance of pluginInstances) {
      instanceByProjectPluginId.set(
        `${pluginInstance.projectSlug}:${pluginInstance.pluginId}`,
        {
          id: pluginInstance.id,
          status: pluginInstance.status,
          configJson: pluginInstance.configJson,
          updatedAt: pluginInstance.updatedAt,
        },
      );
    }

    const pluginSummariesByPluginId = new Map<
      PluginId,
      Map<
        string,
        {
          summaryLines: string[];
          badges: PluginSurfaceBadge[];
          issues: OrganizationPluginIssue[];
        }
      >
    >();

    await Promise.all(
      pluginCatalog.map(async (catalog) => {
        const instancesByProjectSlug = new Map<
          string,
          { status: string | null; configJson: unknown } | null
        >(
          projects.map((project) => {
            const instance = instanceByProjectPluginId.get(
              `${project.slug}:${catalog.pluginId}`,
            );
            return [
              project.slug,
              instance
                ? {
                    status: instance.status ?? null,
                    configJson: instance.configJson ?? null,
                  }
                : null,
            ] as const;
          }),
        );

        const summaries = await buildOrganizationPluginProjectSummaries({
          pluginId: catalog.pluginId,
          organizationId,
          projectSlugs,
          instancesByProjectSlug,
        });

        pluginSummariesByPluginId.set(catalog.pluginId, summaries);
      }),
    );

    const deployedByProjectSlug = new Map<
      string,
      { domain: string; publishedAt: Date }
    >();
    for (const row of publishedRows) {
      const existing = deployedByProjectSlug.get(row.projectSlug);
      if (!existing || row.publishedAt > existing.publishedAt) {
        deployedByProjectSlug.set(row.projectSlug, {
          domain: row.domain,
          publishedAt: row.publishedAt,
        });
      }
    }

    const rows = projects.map((project) => {
      const projectSlug = project.slug;
      const plugins = pluginCatalog.map((catalog): OrganizationProjectPluginItem => {
        const instance = instanceByProjectPluginId.get(
          `${projectSlug}:${catalog.pluginId}`,
        );
        const status = toPluginInstanceStatus(instance?.status ?? null);
        const pluginSummary =
          pluginSummariesByPluginId.get(catalog.pluginId)?.get(projectSlug) ?? {
            summaryLines: [],
            badges: [],
            issues: [] as OrganizationPluginIssue[],
          };

        return {
          pluginId: catalog.pluginId,
          catalog,
          installState: status === "enabled" ? "enabled" : "disabled",
          entitled: status === "enabled",
          entitlementState: status === "enabled" ? "enabled" : "disabled",
          instanceId: instance?.id ?? null,
          instanceStatus: instance?.status ?? null,
          updatedAt: instance?.updatedAt?.toISOString() ?? null,
          accessRequest: {
            status: "not_requested",
            requestedAt: null,
            requestedByUserId: null,
            requesterEmail: null,
          },
          summaryLines: pluginSummary.summaryLines,
          badges: pluginSummary.badges,
        };
      });

      const issues = pluginCatalog.flatMap(
        (catalog) =>
          pluginSummariesByPluginId
            .get(catalog.pluginId)
            ?.get(projectSlug)?.issues ?? [],
      );

      return {
        projectSlug,
        projectTitle: project.title,
        updatedAt: project.updatedAt.toISOString(),
        deployedDomain: deployedByProjectSlug.get(projectSlug)?.domain ?? null,
        plugins,
        issues,
      };
    });

    return {
      rows: rows.sort((left, right) => {
        if (right.issues.length !== left.issues.length) {
          return right.issues.length - left.issues.length;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      }),
    };
  }),

  listMembers: orgAdminProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    const members = await db.query.organizationMember.findMany({
      where: eq(organizationMember.organizationId, organizationId),
      with: { user: true },
    });

    const userIds = members.map((m) => m.userId);
    const assignments =
      userIds.length > 0
        ? await db.query.projectMember.findMany({
            where: and(
              eq(projectMember.organizationId, organizationId),
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
          emailVerified: m.user.emailVerified,
          name: m.user.name,
          role: m.user.role,
          createdAt: m.user.createdAt,
          updatedAt: m.user.updatedAt,
        },
      })),
    };
  }),

  listInvitations: orgAdminProcedure.query(async ({ ctx }) => {
    try {
      return await organizationInvitationService.listOrganizationInvitations(
        ctx.organizationId!,
      );
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: getOrganizationInvitationErrorMessage(
          error,
          "Failed to load invitations",
        ),
      });
    }
  }),

  inviteMember: orgAdminProcedure
    .input(
      z
        .object({
          email: z.string().email(),
          name: z.string().min(1).max(128).optional(),
          role: memberRoleSchema.optional().default("member"),
          projectSlug: z.string().min(1).optional(),
        })
        .refine((data) => (data.role === "client_editor" ? !!data.projectSlug : true), {
          message: "Project is required for client editor accounts",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: ctx.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.inviteMember({
          organizationId: ctx.organizationId!,
          email: input.email,
          inviteeName: input.name,
          role: input.role,
          projectSlug: input.projectSlug,
          inviterId: ctx.session.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to send invitation",
          ),
        });
      }
    }),

  resendInvitation: orgAdminProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: ctx.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.resendInvite({
          invitationId: input.invitationId,
          organizationId: ctx.organizationId!,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to resend invitation",
          ),
        });
      }
    }),

  cancelInvitation: orgAdminProcedure
    .input(
      z.object({
        invitationId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await organizationInvitationService.cancelInvite({
          invitationId: input.invitationId,
          organizationId: ctx.organizationId!,
        });
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to cancel invitation",
          ),
        });
      }
    }),

  createUser: orgAdminProcedure
    .input(
      z
        .object({
          email: z.string().email(),
          name: z.string().min(1).max(128).optional(),
          password: z.string().min(8).optional(),
          role: memberRoleSchema.optional().default("member"),
          projectSlug: z.string().min(1).optional(),
        })
        .refine((data) => (data.role === "client_editor" ? !!data.projectSlug : true), {
          message: "Project is required for client editor accounts",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      const normalizedEmail = input.email.toLowerCase();

      if (input.role === "client_editor" && input.projectSlug) {
        const project = await db.query.projectMeta.findFirst({
          where: and(
            eq(projectMeta.organizationId, organizationId),
            eq(projectMeta.slug, input.projectSlug),
          ),
          columns: { slug: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Project not found",
          });
        }
      }

      const globalRole = getGlobalUserRoleForMemberRole(input.role);

      const existingUser = await db.query.user.findFirst({
        where: eq(userTable.email, normalizedEmail),
        columns: { id: true },
      });

      const userId = existingUser?.id;
      if (userId) {
        const existingMembership = await db.query.organizationMember.findFirst({
          where: and(
            eq(organizationMember.organizationId, organizationId),
            eq(organizationMember.userId, userId),
          ),
          columns: { id: true },
        });
        if (existingMembership) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User is already a member of this organization",
          });
        }

        await db
          .insert(organizationMember)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            userId,
            role: input.role,
          })
          .onConflictDoNothing({
            target: [organizationMember.organizationId, organizationMember.userId],
          });

        if (input.role === "client_editor" && input.projectSlug) {
          await db
            .insert(projectMember)
            .values({
              id: crypto.randomUUID(),
              organizationId,
              userId,
              projectSlug: input.projectSlug,
            })
            .onConflictDoUpdate({
              target: [projectMember.organizationId, projectMember.userId],
              set: { projectSlug: input.projectSlug },
            });
        }

        return { success: true, userId, created: false };
      }

      if (!input.name || !input.password) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Name and password are required to create a new user",
        });
      }

      let created: unknown;
      try {
        created = await auth.api.createUser({
          body: {
            email: normalizedEmail,
            password: input.password,
            name: input.name,
            role: globalRole,
          },
        } as any);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create user";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }

      const createdUserId = (created as any)?.user?.id as string | undefined;
      if (!createdUserId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      await db
        .insert(organizationMember)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          userId: createdUserId,
          role: input.role,
        })
        .onConflictDoNothing({
          target: [organizationMember.organizationId, organizationMember.userId],
        });

      if (input.role === "client_editor" && input.projectSlug) {
        await db
          .insert(projectMember)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            userId: createdUserId,
            projectSlug: input.projectSlug,
          })
          .onConflictDoUpdate({
            target: [projectMember.organizationId, projectMember.userId],
            set: { projectSlug: input.projectSlug },
          });
      }

      return { success: true, userId: createdUserId, created: true };
    }),

  updateMemberRole: orgAdminProcedure
    .input(
      z
        .object({
          userId: z.string().min(1),
          role: memberRoleSchema,
          projectSlug: z.string().min(1).optional(),
        })
        .refine((data) => (data.role === "client_editor" ? !!data.projectSlug : true), {
          message: "Project is required for client editor accounts",
          path: ["projectSlug"],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own role",
        });
      }

      const membership = await db.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, organizationId),
          eq(organizationMember.userId, input.userId),
        ),
        columns: { role: true },
      });

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      if (membership.role === "owner") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Owner role cannot be changed in v1",
        });
      }

      if (input.role === "client_editor" && input.projectSlug) {
        const project = await db.query.projectMeta.findFirst({
          where: and(
            eq(projectMeta.organizationId, organizationId),
            eq(projectMeta.slug, input.projectSlug),
          ),
          columns: { slug: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Project not found",
          });
        }
      }

      await db
        .update(organizationMember)
        .set({ role: input.role })
        .where(
          and(
            eq(organizationMember.organizationId, organizationId),
            eq(organizationMember.userId, input.userId),
          ),
        );

      const globalRole = getGlobalUserRoleForMemberRole(input.role);
      await db
        .update(userTable)
        .set({ role: globalRole })
        .where(eq(userTable.id, input.userId));

      if (input.role === "client_editor" && input.projectSlug) {
        await db
          .insert(projectMember)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            userId: input.userId,
            projectSlug: input.projectSlug,
          })
          .onConflictDoUpdate({
            target: [projectMember.organizationId, projectMember.userId],
            set: { projectSlug: input.projectSlug },
          });
      } else {
        await db
          .delete(projectMember)
          .where(
            and(
              eq(projectMember.organizationId, organizationId),
              eq(projectMember.userId, input.userId),
            ),
          );
      }

      return { success: true };
    }),

  resetMemberPassword: orgAdminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        newPassword: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use account settings to change your own password",
        });
      }

      const membership = await db.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, organizationId),
          eq(organizationMember.userId, input.userId),
        ),
        columns: { role: true },
      });

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      if (membership.role === "owner" && ctx.session.user.role !== "super_admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Owner password cannot be reset by organization admins",
        });
      }

      try {
        await auth.api.setUserPassword({
          body: {
            userId: input.userId,
            newPassword: input.newPassword,
          },
        } as any);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to reset password";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }

      return { success: true };
    }),

  removeMember: orgAdminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId!;
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself",
        });
      }

      const membership = await db.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, organizationId),
          eq(organizationMember.userId, input.userId),
        ),
        columns: { role: true },
      });

      if (!membership) {
        return { success: true };
      }

      if (membership.role === "owner") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Owner cannot be removed in v1",
        });
      }

      await db
        .delete(projectMember)
        .where(
          and(
            eq(projectMember.organizationId, organizationId),
            eq(projectMember.userId, input.userId),
          ),
        );

      await db
        .delete(organizationMember)
        .where(
          and(
            eq(organizationMember.organizationId, organizationId),
            eq(organizationMember.userId, input.userId),
          ),
        );

      return { success: true };
    }),

  getInviteDetails: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      try {
        const invitation = await organizationInvitationService.getPublicInvite(
          input.token,
        );
        if (!invitation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invitation not found",
          });
        }
        return invitation;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to load invitation",
          ),
        });
      }
    }),

  acceptInviteWithSignup: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        name: z.string().min(2).max(128),
        password: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: null,
        requestIp: ctx.requestIp,
        userId: null,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.acceptInviteWithSignup(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to accept invitation",
          ),
        });
      }
    }),

  acceptInviteForSignedInUser: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceInviteRateLimit({
        organizationId: ctx.organizationId,
        requestIp: ctx.requestIp,
        userId: ctx.session.user.id,
        res: ctx.res,
      });

      try {
        return await organizationInvitationService.acceptInviteForUser({
          token: input.token,
          sessionId: ctx.session.session.id,
          userId: ctx.session.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: getOrganizationInvitationErrorMessage(
            error,
            "Failed to accept invitation",
          ),
        });
      }
    }),
});
