import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  orgAdminProcedure,
  router,
} from "../trpc";
import { db } from "../db";
import { projectMember } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export const userRouter = router({
  hasUsers: publicProcedure.query(async () => {
    try {
      const user = await db.query.user.findFirst();
      return { hasUsers: !!user };
    } catch (error) {
      console.error("Failed to check users:", error);
      return { hasUsers: false };
    }
  }),

  /**
   * Get the assigned project for the current user (for client_editors).
   * Returns null if user has no assigned project or is not a client_editor.
   */
  getMyAssignedProject: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const role = ctx.organizationRole;
    const organizationId = ctx.organizationId;

    // Only client_editors have project assignments
    if (role !== "client_editor") {
      return { projectSlug: null };
    }

    if (!organizationId) {
      return { projectSlug: null };
    }

    const membership = await db.query.projectMember.findFirst({
      where: and(
        eq(projectMember.organizationId, organizationId),
        eq(projectMember.userId, userId),
      ),
    });

    return { projectSlug: membership?.projectSlug ?? null };
  }),

  /**
   * Assign a user to a project (admin only).
   * For v1, a user can only be assigned to one project.
   */
  assignUserToProject: orgAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        projectSlug: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId ?? "default";
      const { userId, projectSlug } = input;

      // Remove existing assignment if any
      await db
        .delete(projectMember)
        .where(
          and(
            eq(projectMember.organizationId, organizationId),
            eq(projectMember.userId, userId),
          ),
        );

      // Create new assignment
      await db.insert(projectMember).values({
        id: randomUUID(),
        organizationId,
        userId,
        projectSlug,
      });

      return { success: true, userId, projectSlug };
    }),

  /**
   * Remove a user's project assignment (admin only).
   */
  unassignUserFromProject: orgAdminProcedure
    .input(
      z.object({
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.organizationId ?? "default";
      await db
        .delete(projectMember)
        .where(
          and(
            eq(projectMember.organizationId, organizationId),
            eq(projectMember.userId, input.userId),
          ),
        );
      return { success: true };
    }),

  /**
   * List all project members (admin only).
   */
  listProjectMembers: orgAdminProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.organizationId ?? "default";
    const members = await db.query.projectMember.findMany({
      where: eq(projectMember.organizationId, organizationId),
      with: { user: true },
    });
    return { members };
  }),
});
