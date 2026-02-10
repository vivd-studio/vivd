import { z } from "zod";
import crypto from "node:crypto";
import { router, superAdminProcedure } from "../trpc";
import { db } from "../db";
import { organization, organizationMember } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
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

const limitsPatchSchema = z
  .object({
    dailyCreditLimit: z.number().nonnegative().optional(),
    weeklyCreditLimit: z.number().nonnegative().optional(),
    monthlyCreditLimit: z.number().nonnegative().optional(),
    imageGenPerMonth: z.number().int().nonnegative().optional(),
    warningThreshold: z.number().min(0).max(1).optional(),
  })
  .strict();

export const superAdminRouter = router({
  listOrganizations: superAdminProcedure.query(async () => {
    const rows = await db
      .select({
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        status: organization.status,
        limits: organization.limits,
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
      const [limits, currentUsage] = await Promise.all([
        limitsService.checkLimits(input.organizationId),
        usageService.getCurrentUsage(input.organizationId),
      ]);

      return {
        limits,
        currentUsage,
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
        limits: {},
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

      return {
        members: members.map((m) => ({
          id: m.id,
          organizationId: m.organizationId,
          userId: m.userId,
          role: m.role,
          createdAt: m.createdAt,
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

  setOrganizationMemberRole: superAdminProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        userId: z.string().min(1),
        role: organizationRoleSchema,
      }),
    )
    .mutation(async ({ input }) => {
      await db
        .update(organizationMember)
        .set({ role: input.role })
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
        name: z.string().min(1).max(128),
        password: z.string().min(8),
        userRole: z
          .enum(["super_admin", "admin", "user", "client_editor"])
          .optional(),
        organizationRole: organizationRoleSchema.optional().default("admin"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const headers = headersFromNode(ctx.req.headers as any);

      const userRole =
        input.userRole ??
        (input.organizationRole === "client_editor" ? "client_editor" : "user");

      const created = await auth.api.createUser({
        headers,
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
          role: userRole,
        },
      });

      const createdUserId = (created as any)?.user?.id as string | undefined;
      if (!createdUserId) {
        throw new Error("Failed to create user");
      }

      await db
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

      return { success: true, userId: createdUserId };
    }),
});
