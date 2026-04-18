import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getOrganizationInvitationStorageErrorMessage } from "../../services/auth/OrganizationInvitationService";
import { controlPlaneRateLimitService } from "../../services/system/ControlPlaneRateLimitService";

export const memberRoleSchema = z.enum(["admin", "member", "client_editor"]);

export type MemberRole = z.infer<typeof memberRoleSchema>;

export function getGlobalUserRoleForMemberRole(_role: MemberRole): "user" {
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
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Invite request budget exceeded. Please wait a moment and retry.",
    });
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
