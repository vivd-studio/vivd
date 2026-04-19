import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  organizationMember,
  projectMember,
  user as userTable,
} from "../../db/schema";
import { organizationIdSchema } from "../../lib/organizationIdentifiers";
import { superAdminProcedure } from "../../trpc";
import {
  ensureOrganizationProjectExists,
  getGlobalUserRoleForOrganizationRole,
  orgMemberRoleSchema,
  upsertOrganizationProjectAssignment,
} from "./shared";

export const organizationMemberSuperAdminProcedures = {
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
        columns: { id: true, email: true, name: true, role: true },
      });
      return {
        exists: !!existingUser,
        user: existingUser
          ? {
              id: existingUser.id,
              email: existingUser.email,
              name: existingUser.name,
              role: existingUser.role,
            }
          : null,
      };
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
            name: member.user.name,
            role: member.user.role,
            createdAt: member.user.createdAt,
            updatedAt: member.user.updatedAt,
          },
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
          await ensureOrganizationProjectExists(
            tx,
            input.organizationId,
            input.projectSlug,
          );
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
          await upsertOrganizationProjectAssignment(tx, {
            organizationId: input.organizationId,
            userId: input.userId,
            projectSlug: input.projectSlug,
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
};
