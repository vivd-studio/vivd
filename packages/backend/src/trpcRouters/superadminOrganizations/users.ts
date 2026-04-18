import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../../auth";
import { db } from "../../db";
import {
  organizationMember,
  user as userTable,
} from "../../db/schema";
import { organizationIdSchema } from "../../lib/organizationIdentifiers";
import { superAdminProcedure } from "../../trpc";
import {
  authCreateUserResponseSchema,
  ensureOrganizationProjectExists,
  getGlobalUserRoleForOrganizationRole,
  headersFromNode,
  organizationRoleSchema,
  upsertOrganizationProjectAssignment,
} from "./shared";

export const organizationUserCreationSuperAdminProcedures = {
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
        await ensureOrganizationProjectExists(
          db,
          input.organizationId,
          input.projectSlug,
        );
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
            await upsertOrganizationProjectAssignment(tx, {
              organizationId: input.organizationId,
              userId: existingUser.id,
              projectSlug: input.projectSlug,
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
          await upsertOrganizationProjectAssignment(tx, {
            organizationId: input.organizationId,
            userId: createdUserId,
            projectSlug: input.projectSlug,
          });
        }
      });

      return { success: true, userId: createdUserId, created: true };
    }),
};
