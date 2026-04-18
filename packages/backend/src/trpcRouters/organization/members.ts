import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../../auth";
import { db } from "../../db";
import {
  organizationMember,
  projectMember,
  projectMeta,
  user as userTable,
} from "../../db/schema";
import { orgAdminProcedure } from "../../trpc";
import {
  getGlobalUserRoleForMemberRole,
  memberRoleSchema,
} from "./shared";

async function ensureProjectExists(organizationId: string, projectSlug: string) {
  const project = await db.query.projectMeta.findFirst({
    where: and(
      eq(projectMeta.organizationId, organizationId),
      eq(projectMeta.slug, projectSlug),
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

async function upsertProjectAssignment(input: {
  organizationId: string;
  userId: string;
  projectSlug: string;
}) {
  await db
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
}

export const organizationMembershipProcedures = {
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

  listMembers: orgAdminProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId!;
    const members = await db.query.organizationMember.findMany({
      where: eq(organizationMember.organizationId, organizationId),
      with: { user: true },
    });

    const userIds = members.map((member) => member.userId);
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

    const projectByUserId = new Map(
      assignments.map((assignment) => [assignment.userId, assignment.projectSlug]),
    );

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
          emailVerified: member.user.emailVerified,
          name: member.user.name,
          role: member.user.role,
          createdAt: member.user.createdAt,
          updatedAt: member.user.updatedAt,
        },
      })),
    };
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
        await ensureProjectExists(organizationId, input.projectSlug);
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
          await upsertProjectAssignment({
            organizationId,
            userId,
            projectSlug: input.projectSlug,
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
        await upsertProjectAssignment({
          organizationId,
          userId: createdUserId,
          projectSlug: input.projectSlug,
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
        await ensureProjectExists(organizationId, input.projectSlug);
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
        await upsertProjectAssignment({
          organizationId,
          userId: input.userId,
          projectSlug: input.projectSlug,
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
};
