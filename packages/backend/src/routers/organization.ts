import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { z } from "zod";
import { router, orgAdminProcedure, orgProcedure } from "../trpc";
import { db } from "../db";
import {
  organization,
  organizationMember,
  projectMember,
  projectMeta,
  user as userTable,
} from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "../auth";

const memberRoleSchema = z.enum(["admin", "member", "client_editor"]);

function getGlobalUserRoleForMemberRole(
  _role: z.infer<typeof memberRoleSchema>,
): "user" {
  return "user";
}

export const organizationRouter = router({
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
          name: m.user.name,
          role: m.user.role,
          createdAt: m.user.createdAt,
          updatedAt: m.user.updatedAt,
        },
      })),
    };
  }),

  createUser: orgAdminProcedure
    .input(
      z
        .object({
          email: z.string().email(),
          name: z.string().min(1).max(128),
          password: z.string().min(8),
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

      return { success: true, userId: createdUserId };
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
});
