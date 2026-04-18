import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../../db";
import { projectMember, projectMeta } from "../../db/schema";
import { getOrganizationInvitationStorageErrorMessage } from "../../services/auth/OrganizationInvitationService";
import { controlPlaneRateLimitService } from "../../services/system/ControlPlaneRateLimitService";

export const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "client_editor",
]);
export const orgMemberRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "client_editor",
]);
export const domainUsageSchema = z.enum(["tenant_host", "publish_target"]);
export const domainTypeSchema = z.enum(["managed_subdomain", "custom_domain"]);
export const domainStatusSchema = z.enum([
  "active",
  "disabled",
  "pending_verification",
]);

export const limitsPatchSchema = z
  .object({
    dailyCreditLimit: z.number().nonnegative().optional(),
    weeklyCreditLimit: z.number().nonnegative().optional(),
    monthlyCreditLimit: z.number().nonnegative().optional(),
    imageGenPerMonth: z.number().int().nonnegative().optional(),
    warningThreshold: z.number().min(0).max(1).optional(),
    maxProjects: z.number().int().nonnegative().optional(),
  })
  .strict();

export const authCreateUserResponseSchema = z
  .object({
    user: z.object({
      id: z.string().min(1),
    }),
  })
  .passthrough();

export function headersFromNode(reqHeaders: Record<string, unknown>): Headers {
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

export function getGlobalUserRoleForOrganizationRole(
  _role: z.infer<typeof organizationRoleSchema>,
): "user" {
  return "user";
}

export async function enforceInviteRateLimit(input: {
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

export function getOrganizationInvitationErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return (
    getOrganizationInvitationStorageErrorMessage(error) ??
    (error instanceof Error ? error.message : fallback)
  );
}

type OrganizationDbExecutor = typeof db | PgTransaction<any, any, any>;

export async function ensureOrganizationProjectExists(
  executor: OrganizationDbExecutor,
  organizationId: string,
  projectSlug: string,
) {
  const [project] = await executor
    .select({ slug: projectMeta.slug })
    .from(projectMeta)
    .where(
      and(
        eq(projectMeta.organizationId, organizationId),
        eq(projectMeta.slug, projectSlug),
      ),
    )
    .limit(1);
  if (!project) {
    throw new Error("Project not found");
  }
}

export async function upsertOrganizationProjectAssignment(
  executor: OrganizationDbExecutor,
  input: {
    organizationId: string;
    userId: string;
    projectSlug: string;
  },
) {
  await executor
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
