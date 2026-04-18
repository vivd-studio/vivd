import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auth } from "../../auth";
import { db } from "../../db";
import {
  organization,
  organizationInvitation,
  organizationMember,
  projectMember,
  projectMeta,
  session as sessionTable,
  user as userTable,
} from "../../db/schema";
import { inferSchemeForHost, resolveAuthBaseUrlFromEnv } from "../../lib/publicOrigin";
import { buildOrganizationInvitationEmail } from "../email/templates";
import { getEmailDeliveryService } from "../integrations/EmailDeliveryService";
import { domainService } from "../publish/DomainService";
import { instanceNetworkSettingsService } from "../system/InstanceNetworkSettingsService";

export type OrganizationInviteRole = "owner" | "admin" | "member" | "client_editor";
export type OrganizationInviteState =
  | "pending"
  | "accepted"
  | "canceled"
  | "expired";

type InvitationRecord = {
  id: string;
  organizationId: string;
  email: string;
  inviteeName: string | null;
  role: string;
  projectSlug: string | null;
  tokenHash: string | null;
  status: string;
  inviterId: string | null;
  acceptedByUserId: string | null;
  expiresAt: Date;
  lastSentAt: Date | null;
  acceptedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  inviter:
    | {
        id: string;
        name: string;
        email: string;
      }
    | null;
};

export type OrganizationInviteSummary = {
  id: string;
  email: string;
  inviteeName: string | null;
  role: OrganizationInviteRole;
  state: OrganizationInviteState;
  projectSlug: string | null;
  projectTitle: string | null;
  inviterName: string | null;
  inviterEmail: string | null;
  expiresAt: string;
  lastSentAt: string | null;
  acceptedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicOrganizationInvite = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationStatus: string;
  email: string;
  inviteeName: string | null;
  role: OrganizationInviteRole;
  state: OrganizationInviteState;
  projectSlug: string | null;
  projectTitle: string | null;
  inviterName: string | null;
  inviterEmail: string | null;
  hasExistingAccount: boolean;
  expiresAt: string;
};

export type AcceptInviteResult = {
  organizationId: string;
  tenantHost: string | null;
};

type SendInviteInput = {
  organizationId: string;
  email: string;
  inviteeName?: string | null;
  role: OrganizationInviteRole;
  projectSlug?: string | null;
  inviterId: string;
};

type AcceptInviteWithSignupInput = {
  token: string;
  name: string;
  password: string;
};

type AcceptInviteForUserInput = {
  token: string;
  sessionId: string | null;
  userId: string;
};

const DEFAULT_ORGANIZATION_INVITE_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
const ORGANIZATION_INVITE_STORAGE_MIGRATION = "0029_organization_member_invites.sql";
const ORGANIZATION_INVITE_STORAGE_COLUMNS = [
  "invitee_name",
  "project_slug",
  "token_hash",
  "accepted_by_user_id",
  "last_sent_at",
  "accepted_at",
  "canceled_at",
  "updated_at",
];

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const maybeCause = (error as { cause?: unknown }).cause;
    const causeMessage =
      maybeCause && typeof maybeCause === "object" && "message" in maybeCause
        ? String(maybeCause.message ?? "")
        : "";
    return `${error.message} ${causeMessage}`.trim().toLowerCase();
  }
  return String(error ?? "").toLowerCase();
}

export function getOrganizationInvitationStorageErrorMessage(
  error: unknown,
): string | null {
  const text = errorText(error);
  if (!text) return null;

  const mentionsInvitationTable =
    text.includes("organization_invitation") ||
    text.includes("organizationinvitation");
  const mentionsInviteColumn = ORGANIZATION_INVITE_STORAGE_COLUMNS.some((column) =>
    text.includes(column),
  );
  const looksLikeSchemaDrift =
    text.includes("does not exist") ||
    text.includes("undefined column") ||
    text.includes("42703") ||
    text.includes("42p01");

  if (!mentionsInvitationTable || !mentionsInviteColumn || !looksLikeSchemaDrift) {
    return null;
  }

  return `Organization invite storage is unavailable or out of date. Run backend db:migrate to apply migration ${ORGANIZATION_INVITE_STORAGE_MIGRATION}.`;
}

function createInviteToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getInviteExpiresInSeconds(): number {
  return readPositiveIntEnv(
    "VIVD_ORGANIZATION_INVITE_EXPIRES_IN_SECONDS",
    DEFAULT_ORGANIZATION_INVITE_EXPIRES_IN_SECONDS,
  );
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function roleLabel(role: OrganizationInviteRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "User";
    case "client_editor":
      return "Client Editor";
    default:
      return role;
  }
}

function deriveInvitationState(
  invitation: Pick<
    InvitationRecord,
    "status" | "acceptedAt" | "canceledAt" | "expiresAt"
  >,
): OrganizationInviteState {
  if (invitation.status === "accepted" || invitation.acceptedAt) {
    return "accepted";
  }
  if (invitation.status === "canceled" || invitation.status === "rejected" || invitation.canceledAt) {
    return "canceled";
  }
  if (invitation.expiresAt.getTime() <= Date.now()) {
    return "expired";
  }
  return "pending";
}

function assertInviteRole(role: string): OrganizationInviteRole {
  if (
    role === "owner" ||
    role === "admin" ||
    role === "member" ||
    role === "client_editor"
  ) {
    return role;
  }
  throw new Error("Unsupported invitation role");
}

async function resolveProjectSummary(input: {
  organizationId: string;
  role: OrganizationInviteRole;
  projectSlug: string | null;
}): Promise<{ projectSlug: string | null; projectTitle: string | null }> {
  if (input.role !== "client_editor") {
    return { projectSlug: null, projectTitle: null };
  }

  const normalizedProjectSlug = input.projectSlug?.trim() || null;
  if (!normalizedProjectSlug) {
    throw new Error("Project is required for client editor accounts");
  }

  const project = await db.query.projectMeta.findFirst({
    where: and(
      eq(projectMeta.organizationId, input.organizationId),
      eq(projectMeta.slug, normalizedProjectSlug),
    ),
    columns: {
      slug: true,
      title: true,
    },
  });
  if (!project) {
    throw new Error("Project not found");
  }

  return {
    projectSlug: project.slug,
    projectTitle: project.title || project.slug,
  };
}

function toInviteSummary(input: {
  invitation: InvitationRecord;
  projectTitle: string | null;
}): OrganizationInviteSummary {
  const state = deriveInvitationState(input.invitation);
  return {
    id: input.invitation.id,
    email: input.invitation.email,
    inviteeName: input.invitation.inviteeName,
    role: assertInviteRole(input.invitation.role),
    state,
    projectSlug: input.invitation.projectSlug,
    projectTitle: input.projectTitle,
    inviterName: input.invitation.inviter?.name ?? null,
    inviterEmail: input.invitation.inviter?.email ?? null,
    expiresAt: input.invitation.expiresAt.toISOString(),
    lastSentAt: input.invitation.lastSentAt?.toISOString() ?? null,
    acceptedAt: input.invitation.acceptedAt?.toISOString() ?? null,
    canceledAt: input.invitation.canceledAt?.toISOString() ?? null,
    createdAt: input.invitation.createdAt.toISOString(),
    updatedAt: input.invitation.updatedAt.toISOString(),
  };
}

export class OrganizationInvitationService {
  private async loadOrganization(organizationId: string) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: {
        id: true,
        name: true,
        slug: true,
        status: true,
      },
    });
    if (!org) {
      throw new Error("Organization not found");
    }
    return org;
  }

  private async getTenantHost(organizationId: string): Promise<string | null> {
    return domainService.getActiveTenantHostForOrganization(organizationId);
  }

  private async buildAcceptUrl(
    organizationId: string,
    token: string,
  ): Promise<string> {
    const tenantHost = await this.getTenantHost(organizationId);
    const origin = tenantHost
      ? `${inferSchemeForHost(tenantHost)}://${tenantHost}`
      : this.getPublicOriginFallback();

    return new URL(
      `/vivd-studio/invite?token=${encodeURIComponent(token)}`,
      origin,
    ).toString();
  }

  private getPublicOriginFallback(): string {
    const publicOrigin =
      instanceNetworkSettingsService.getResolvedSettings().publicOrigin ??
      resolveAuthBaseUrlFromEnv();
    if (publicOrigin) {
      return publicOrigin;
    }

    const controlPlaneHost = domainService.getControlPlaneHostForRequest(null) ?? "localhost";
    return `${inferSchemeForHost(controlPlaneHost)}://${controlPlaneHost}`;
  }

  private async sendInviteEmail(input: {
    acceptUrl: string;
    email: string;
    inviteeName: string | null;
    organizationName: string;
    inviterName: string | null;
    inviterEmail: string | null;
    role: OrganizationInviteRole;
    projectTitle: string | null;
    existingAccount: boolean;
  }): Promise<{ accepted: boolean }> {
    const template = await buildOrganizationInvitationEmail({
      acceptUrl: input.acceptUrl,
      existingAccount: input.existingAccount,
      expiresInSeconds: getInviteExpiresInSeconds(),
      organizationName: input.organizationName,
      projectTitle: input.projectTitle,
      recipientName: input.inviteeName,
      roleLabel: roleLabel(input.role),
      inviterName: input.inviterName,
      inviterEmail: input.inviterEmail,
    });

    const result = await getEmailDeliveryService().send({
      to: [input.email],
      subject: template.subject,
      text: template.text,
      html: template.html,
      metadata: {
        category: "auth_org_invite",
      },
    });

    if (!result.accepted) {
      console.error("[OrganizationInvitationService] invite email delivery failed", {
        email: input.email,
        error: result.error,
        provider: result.provider,
      });
    }

    return { accepted: result.accepted };
  }

  private async cancelPendingInvitesForEmail(input: {
    organizationId: string;
    email: string;
    now: Date;
  }): Promise<void> {
    await db
      .update(organizationInvitation)
      .set({
        status: "canceled",
        canceledAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(organizationInvitation.organizationId, input.organizationId),
          eq(organizationInvitation.email, input.email),
          eq(organizationInvitation.status, "pending"),
        ),
      );
  }

  private async getInvitationRecordByToken(
    token: string,
  ): Promise<InvitationRecord | null> {
    const hashedToken = hashInviteToken(token);
    const invitation = await db.query.organizationInvitation.findFirst({
      where: eq(organizationInvitation.tokenHash, hashedToken),
      with: {
        organization: {
          columns: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        inviter: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return invitation ? (invitation as InvitationRecord) : null;
  }

  async listOrganizationInvitations(
    organizationId: string,
  ): Promise<{ invitations: OrganizationInviteSummary[] }> {
    const invitations = await db.query.organizationInvitation.findMany({
      where: eq(organizationInvitation.organizationId, organizationId),
      with: {
        organization: {
          columns: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        inviter: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: (table, { desc: sortDesc }) => [sortDesc(table.createdAt)],
    });

    const nonAccepted = invitations.filter(
      (invitation) => deriveInvitationState(invitation as InvitationRecord) !== "accepted",
    ) as InvitationRecord[];
    const projectSlugs = [
      ...new Set(
        nonAccepted
          .map((invitation) => invitation.projectSlug)
          .filter((projectSlug): projectSlug is string => Boolean(projectSlug)),
      ),
    ];
    const projectTitles = new Map<string, string>();
    if (projectSlugs.length > 0) {
      const projects = await db.query.projectMeta.findMany({
        where: eq(projectMeta.organizationId, organizationId),
        columns: {
          slug: true,
          title: true,
        },
      });
      for (const project of projects) {
        projectTitles.set(project.slug, project.title || project.slug);
      }
    }

    return {
      invitations: nonAccepted.map((invitation) =>
        toInviteSummary({
          invitation,
          projectTitle: invitation.projectSlug
            ? projectTitles.get(invitation.projectSlug) ?? invitation.projectSlug
            : null,
        }),
      ),
    };
  }

  async inviteMember(input: SendInviteInput): Promise<{
    invitationId: string;
    deliveryAccepted: boolean;
  }> {
    const normalizedEmail = normalizeEmail(input.email);
    const normalizedInviteeName = input.inviteeName?.trim() || null;
    const org = await this.loadOrganization(input.organizationId);
    if (org.status !== "active") {
      throw new Error("Organization is suspended");
    }

    const role = assertInviteRole(input.role);
    const { projectSlug, projectTitle } = await resolveProjectSummary({
      organizationId: input.organizationId,
      projectSlug: input.projectSlug?.trim() || null,
      role,
    });

    const existingUser = await db.query.user.findFirst({
      where: eq(userTable.email, normalizedEmail),
      columns: {
        id: true,
      },
    });
    if (existingUser) {
      const existingMembership = await db.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, input.organizationId),
          eq(organizationMember.userId, existingUser.id),
        ),
        columns: {
          id: true,
        },
      });
      if (existingMembership) {
        throw new Error("User is already a member of this organization");
      }
    }

    const inviter = await db.query.user.findFirst({
      where: eq(userTable.id, input.inviterId),
      columns: {
        id: true,
        name: true,
        email: true,
      },
    });

    const now = new Date();
    const expiresAt = addSeconds(now, getInviteExpiresInSeconds());
    const token = createInviteToken();
    const tokenHash = hashInviteToken(token);

    await this.cancelPendingInvitesForEmail({
      organizationId: input.organizationId,
      email: normalizedEmail,
      now,
    });

    const invitationId = crypto.randomUUID();
    await db.insert(organizationInvitation).values({
      id: invitationId,
      organizationId: input.organizationId,
      email: normalizedEmail,
      inviteeName: normalizedInviteeName,
      role,
      projectSlug,
      tokenHash,
      status: "pending",
      inviterId: input.inviterId,
      expiresAt,
      lastSentAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const acceptUrl = await this.buildAcceptUrl(input.organizationId, token);
    const delivery = await this.sendInviteEmail({
      acceptUrl,
      email: normalizedEmail,
      inviteeName: normalizedInviteeName,
      organizationName: org.name,
      inviterName: inviter?.name ?? null,
      inviterEmail: inviter?.email ?? null,
      role,
      projectTitle,
      existingAccount: Boolean(existingUser),
    });

    console.info("[OrganizationInvitationService] invite created", {
      invitationId,
      organizationId: input.organizationId,
      email: normalizedEmail,
      inviterId: input.inviterId,
      role,
    });

    return {
      invitationId,
      deliveryAccepted: delivery.accepted,
    };
  }

  async resendInvite(input: {
    invitationId: string;
    organizationId: string;
  }): Promise<{ deliveryAccepted: boolean }> {
    const invitation = await db.query.organizationInvitation.findFirst({
      where: and(
        eq(organizationInvitation.id, input.invitationId),
        eq(organizationInvitation.organizationId, input.organizationId),
      ),
      with: {
        organization: {
          columns: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        inviter: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new Error("Invitation not found");
    }
    if (deriveInvitationState(invitation) === "accepted") {
      throw new Error("Invitation has already been accepted");
    }
    if (invitation.organization.status !== "active") {
      throw new Error("Organization is suspended");
    }

    const role = assertInviteRole(invitation.role);
    const { projectTitle } = await resolveProjectSummary({
      organizationId: invitation.organizationId,
      projectSlug: invitation.projectSlug,
      role,
    });

    const existingUser = await db.query.user.findFirst({
      where: eq(userTable.email, invitation.email),
      columns: {
        id: true,
      },
    });
    if (existingUser) {
      const existingMembership = await db.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, invitation.organizationId),
          eq(organizationMember.userId, existingUser.id),
        ),
        columns: {
          id: true,
        },
      });
      if (existingMembership) {
        throw new Error("User is already a member of this organization");
      }
    }

    const now = new Date();
    const expiresAt = addSeconds(now, getInviteExpiresInSeconds());
    const token = createInviteToken();
    const tokenHash = hashInviteToken(token);

    await db
      .update(organizationInvitation)
      .set({
        tokenHash,
        status: "pending",
        expiresAt,
        lastSentAt: now,
        acceptedAt: null,
        canceledAt: null,
        updatedAt: now,
      })
      .where(eq(organizationInvitation.id, invitation.id));

    const acceptUrl = await this.buildAcceptUrl(invitation.organizationId, token);
    const delivery = await this.sendInviteEmail({
      acceptUrl,
      email: invitation.email,
      inviteeName: invitation.inviteeName,
      organizationName: invitation.organization.name,
      inviterName: invitation.inviter?.name ?? null,
      inviterEmail: invitation.inviter?.email ?? null,
      role,
      projectTitle,
      existingAccount: Boolean(existingUser),
    });

    console.info("[OrganizationInvitationService] invite resent", {
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
    });

    return { deliveryAccepted: delivery.accepted };
  }

  async cancelInvite(input: {
    invitationId: string;
    organizationId: string;
  }): Promise<void> {
    const invitation = await db.query.organizationInvitation.findFirst({
      where: and(
        eq(organizationInvitation.id, input.invitationId),
        eq(organizationInvitation.organizationId, input.organizationId),
      ),
      columns: {
        id: true,
        status: true,
        acceptedAt: true,
      },
    });
    if (!invitation) {
      throw new Error("Invitation not found");
    }
    if (invitation.status === "accepted" || invitation.acceptedAt) {
      throw new Error("Invitation has already been accepted");
    }

    const now = new Date();
    await db
      .update(organizationInvitation)
      .set({
        status: "canceled",
        canceledAt: now,
        updatedAt: now,
      })
      .where(eq(organizationInvitation.id, input.invitationId));

    console.info("[OrganizationInvitationService] invite canceled", {
      invitationId: input.invitationId,
      organizationId: input.organizationId,
    });
  }

  async getPublicInvite(token: string): Promise<PublicOrganizationInvite | null> {
    const invitation = await this.getInvitationRecordByToken(token);
    if (!invitation) return null;

    const role = assertInviteRole(invitation.role);
    const projectTitle =
      invitation.projectSlug && role === "client_editor"
        ? (
            await db.query.projectMeta.findFirst({
              where: and(
                eq(projectMeta.organizationId, invitation.organizationId),
                eq(projectMeta.slug, invitation.projectSlug),
              ),
              columns: {
                title: true,
                slug: true,
              },
            })
          )?.title ?? invitation.projectSlug
        : null;
    const existingAccount = await db.query.user.findFirst({
      where: eq(userTable.email, invitation.email),
      columns: {
        id: true,
      },
    });

    return {
      id: invitation.id,
      organizationId: invitation.organization.id,
      organizationName: invitation.organization.name,
      organizationSlug: invitation.organization.slug,
      organizationStatus: invitation.organization.status,
      email: invitation.email,
      inviteeName: invitation.inviteeName,
      role,
      state: deriveInvitationState(invitation),
      projectSlug: invitation.projectSlug,
      projectTitle,
      inviterName: invitation.inviter?.name ?? null,
      inviterEmail: invitation.inviter?.email ?? null,
      hasExistingAccount: Boolean(existingAccount),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async acceptInviteForUser(
    input: AcceptInviteForUserInput,
  ): Promise<AcceptInviteResult> {
    const invitation = await this.getInvitationRecordByToken(input.token);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    const state = deriveInvitationState(invitation);
    const user = await db.query.user.findFirst({
      where: eq(userTable.id, input.userId),
      columns: {
        id: true,
        email: true,
      },
    });
    if (!user) {
      throw new Error("User not found");
    }
    if (normalizeEmail(user.email) !== invitation.email) {
      throw new Error("You must sign in with the invited email address");
    }
    if (invitation.organization.status !== "active") {
      throw new Error("Organization is suspended");
    }
    if (state === "canceled") {
      throw new Error("Invitation has been canceled");
    }
    if (state === "expired") {
      throw new Error("Invitation has expired");
    }
    if (state === "accepted") {
      if (input.sessionId) {
        await db
          .update(sessionTable)
          .set({ activeOrganizationId: invitation.organizationId })
          .where(eq(sessionTable.id, input.sessionId));
      }
      return {
        organizationId: invitation.organizationId,
        tenantHost: await this.getTenantHost(invitation.organizationId),
      };
    }

    const role = assertInviteRole(invitation.role);
    const { projectSlug } = await resolveProjectSummary({
      organizationId: invitation.organizationId,
      projectSlug: invitation.projectSlug,
      role,
    });

    const now = new Date();
    await db.transaction(async (tx) => {
      const membership = await tx.query.organizationMember.findFirst({
        where: and(
          eq(organizationMember.organizationId, invitation.organizationId),
          eq(organizationMember.userId, user.id),
        ),
        columns: {
          id: true,
        },
      });

      if (!membership) {
        await tx.insert(organizationMember).values({
          id: crypto.randomUUID(),
          organizationId: invitation.organizationId,
          userId: user.id,
          role,
        });

        if (role === "client_editor" && projectSlug) {
          await tx
            .insert(projectMember)
            .values({
              id: crypto.randomUUID(),
              organizationId: invitation.organizationId,
              userId: user.id,
              projectSlug,
            })
            .onConflictDoUpdate({
              target: [projectMember.organizationId, projectMember.userId],
              set: { projectSlug },
            });
        }
      }

      await tx
        .update(userTable)
        .set({ emailVerified: true })
        .where(eq(userTable.id, user.id));

      await tx
        .update(organizationInvitation)
        .set({
          status: "accepted",
          acceptedByUserId: user.id,
          acceptedAt: now,
          updatedAt: now,
        })
        .where(eq(organizationInvitation.id, invitation.id));

      if (input.sessionId) {
        await tx
          .update(sessionTable)
          .set({ activeOrganizationId: invitation.organizationId })
          .where(eq(sessionTable.id, input.sessionId));
      }
    });

    console.info("[OrganizationInvitationService] invite accepted", {
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      userId: user.id,
    });

    return {
      organizationId: invitation.organizationId,
      tenantHost: await this.getTenantHost(invitation.organizationId),
    };
  }

  async acceptInviteWithSignup(
    input: AcceptInviteWithSignupInput,
  ): Promise<AcceptInviteResult & { email: string }> {
    const invitation = await this.getInvitationRecordByToken(input.token);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    const state = deriveInvitationState(invitation);
    if (invitation.organization.status !== "active") {
      throw new Error("Organization is suspended");
    }
    if (state === "accepted") {
      throw new Error("Invitation has already been accepted");
    }
    if (state === "canceled") {
      throw new Error("Invitation has been canceled");
    }
    if (state === "expired") {
      throw new Error("Invitation has expired");
    }

    const existingUser = await db.query.user.findFirst({
      where: eq(userTable.email, invitation.email),
      columns: {
        id: true,
      },
    });
    if (existingUser) {
      throw new Error("An account already exists for this email. Sign in to accept the invite.");
    }

    const role = assertInviteRole(invitation.role);
    const { projectSlug } = await resolveProjectSummary({
      organizationId: invitation.organizationId,
      projectSlug: invitation.projectSlug,
      role,
    });

    let created: unknown;
    try {
      created = await auth.api.createUser({
        body: {
          email: invitation.email,
          password: input.password,
          name: input.name.trim(),
          role: "user",
        },
      } as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create user";
      throw new Error(message);
    }

    const createdUserId = (created as { user?: { id?: string } } | null)?.user?.id;
    if (!createdUserId) {
      throw new Error("Failed to create user");
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(userTable)
        .set({ emailVerified: true })
        .where(eq(userTable.id, createdUserId));

      await tx
        .insert(organizationMember)
        .values({
          id: crypto.randomUUID(),
          organizationId: invitation.organizationId,
          userId: createdUserId,
          role,
        })
        .onConflictDoNothing({
          target: [organizationMember.organizationId, organizationMember.userId],
        });

      if (role === "client_editor" && projectSlug) {
        await tx
          .insert(projectMember)
          .values({
            id: crypto.randomUUID(),
            organizationId: invitation.organizationId,
            userId: createdUserId,
            projectSlug,
          })
          .onConflictDoUpdate({
            target: [projectMember.organizationId, projectMember.userId],
            set: { projectSlug },
          });
      }

      await tx
        .update(organizationInvitation)
        .set({
          status: "accepted",
          acceptedByUserId: createdUserId,
          acceptedAt: now,
          updatedAt: now,
        })
        .where(eq(organizationInvitation.id, invitation.id));
    });

    console.info("[OrganizationInvitationService] invite accepted with signup", {
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      userId: createdUserId,
    });

    return {
      email: invitation.email,
      organizationId: invitation.organizationId,
      tenantHost: await this.getTenantHost(invitation.organizationId),
    };
  }
}

export const organizationInvitationService = new OrganizationInvitationService();
