import { initTRPC, TRPCError } from "@trpc/server";
import * as trpcExpress from "@trpc/server/adapters/express";
import { getSession } from "./lib/authProvider";
import { z } from "zod";
import { db } from "./db";
import {
  organization,
  organizationMember,
  projectMember,
  session as sessionTable,
} from "./db/schema";
import { and, asc, eq } from "drizzle-orm";
import { domainService } from "./services/publish/DomainService";
import { normalizeOrganizationId } from "./lib/organizationIdentifiers";
import { studioMachineProvider } from "./services/studioMachines";
import type { StudioRuntimeAuthIdentity } from "./services/studioMachines/types";

type UserMembership = {
  organizationId: string;
  role: string;
};

const DEFAULT_HOST_RESOLUTION_LOG_THROTTLE_MS = 10_000;
const hostResolutionLogAtBySignature = new Map<string, number>();
const STUDIO_RUNTIME_TOKEN_HEADER = "x-vivd-studio-token";
const STUDIO_RUNTIME_ID_HEADER = "x-vivd-studio-id";

function getHostResolutionLogThrottleMs(): number {
  const raw = process.env.HOST_RESOLUTION_LOG_THROTTLE_MS;
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_HOST_RESOLUTION_LOG_THROTTLE_MS;
}

function shouldLogHostResolution(signature: string): boolean {
  if (process.env.HOST_RESOLUTION_LOGGING === "false") return false;

  const throttleMs = getHostResolutionLogThrottleMs();
  if (throttleMs <= 0) return true;

  const now = Date.now();
  const lastLoggedAt = hostResolutionLogAtBySignature.get(signature) ?? 0;
  if (now - lastLoggedAt < throttleMs) return false;

  hostResolutionLogAtBySignature.set(signature, now);
  if (hostResolutionLogAtBySignature.size > 500) {
    const oldestKey = hostResolutionLogAtBySignature.keys().next().value;
    if (oldestKey) hostResolutionLogAtBySignature.delete(oldestKey);
  }

  return true;
}

function pickPreferredOrganizationId(memberships: UserMembership[]): string | null {
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return memberships[0]?.organizationId ?? null;

  const preferredAdminOrg = memberships.find(
    (m) =>
      m.organizationId !== "default" &&
      (m.role === "owner" || m.role === "admin"),
  );
  if (preferredAdminOrg) return preferredAdminOrg.organizationId;

  const preferredNonDefault = memberships.find((m) => m.organizationId !== "default");
  if (preferredNonDefault) return preferredNonDefault.organizationId;

  return memberships[0]?.organizationId ?? null;
}

function readForwardedHost(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") {
    const normalized = value.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const normalized = value[0]?.split(",")[0]?.trim() ?? "";
    return normalized || null;
  }
  return null;
}

function extractRequestHost(req: trpcExpress.CreateExpressContextOptions["req"]): string | null {
  const forwarded = readForwardedHost(req.headers["x-forwarded-host"]);
  if (forwarded) return forwarded;

  const host = readForwardedHost(req.headers.host);
  if (host) return host;
  return null;
}

export const createContext = async ({
  req,
  res,
}: trpcExpress.CreateExpressContextOptions) => {
  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (typeof value === "string") {
      headers.append(key, value);
    } else if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    }
  });

  let session = await getSession(headers);
  const resolvedHost = await domainService.resolveHost(extractRequestHost(req));
  const requestedOrganizationId = normalizeOrganizationId(
    headers.get("x-vivd-organization-id"),
  );
  const authHeader = headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  const studioRuntimeToken = headers.get(STUDIO_RUNTIME_TOKEN_HEADER)?.trim() || null;
  const studioRuntimeId = headers.get(STUDIO_RUNTIME_ID_HEADER)?.trim() || null;

  // Fallback for machine-to-backend calls (e.g. Studio UsageReporter):
  // allow `Authorization: Bearer <session.token>` in addition to cookie-based sessions.
  let sessionRecordFromDb: { id: string; activeOrganizationId: string | null } | null = null;
  if (!session) {
    if (bearerToken) {
      const sessionRecord = await db.query.session.findFirst({
        where: eq(sessionTable.token, bearerToken),
        with: {
          user: true,
        },
      });

      if (
        sessionRecord &&
        (!sessionRecord.expiresAt || new Date(sessionRecord.expiresAt) > new Date())
      ) {
        sessionRecordFromDb = {
          id: sessionRecord.id,
          activeOrganizationId: sessionRecord.activeOrganizationId ?? null,
        };
        session = {
          session: {
            id: sessionRecord.id,
            userId: sessionRecord.userId,
            expiresAt: new Date(sessionRecord.expiresAt),
            createdAt: new Date(sessionRecord.createdAt),
            updatedAt: new Date(sessionRecord.updatedAt),
            ipAddress: sessionRecord.ipAddress,
            userAgent: sessionRecord.userAgent,
          },
          user: {
            id: sessionRecord.user.id,
            email: sessionRecord.user.email,
            name: sessionRecord.user.name,
            role:
              (sessionRecord.user.role as
                | "super_admin"
                | "admin"
                | "user"
                | "client_editor") ?? "user",
            emailVerified: !!sessionRecord.user.emailVerified,
            image: sessionRecord.user.image,
            createdAt: new Date(sessionRecord.user.createdAt),
            updatedAt: new Date(sessionRecord.user.updatedAt),
          },
        };
      }
    }
  }

  let studioRuntimeAuth: StudioRuntimeAuthIdentity | null = null;
  if (
    !session &&
    studioRuntimeId &&
    studioRuntimeToken &&
    typeof studioMachineProvider.resolveRuntimeAuth === "function"
  ) {
    studioRuntimeAuth = await studioMachineProvider.resolveRuntimeAuth(
      studioRuntimeId,
      studioRuntimeToken,
    );
  }

  if (session && !sessionRecordFromDb) {
    const record = await db.query.session.findFirst({
      where: eq(sessionTable.id, session.session.id),
      columns: {
        id: true,
        activeOrganizationId: true,
      },
    });
    if (record) {
      sessionRecordFromDb = {
        id: record.id,
        activeOrganizationId: record.activeOrganizationId ?? null,
      };
    }
  }

  const hostOrganizationId = resolvedHost.hostOrganizationId;
  const canSelectOrganization = resolvedHost.canSelectOrganization;
  const canUseSessionSelectedOrganization =
    canSelectOrganization || resolvedHost.hostKind === "unknown";

  let organizationId = hostOrganizationId
    ? hostOrganizationId
    : canUseSessionSelectedOrganization
      ? sessionRecordFromDb?.activeOrganizationId ?? null
      : null;

  const memberships = session
    ? await db.query.organizationMember.findMany({
        where: eq(organizationMember.userId, session.user.id),
        columns: { organizationId: true, role: true },
        orderBy: [asc(organizationMember.createdAt)],
      })
    : [];
  const membershipRoleByOrg = new Map(
    memberships.map((m) => [m.organizationId, m.role] as const),
  );

  if (session && requestedOrganizationId && !hostOrganizationId) {
    const hasAccess =
      session.user.role === "super_admin" ||
      membershipRoleByOrg.has(requestedOrganizationId);
    if (hasAccess) {
      organizationId = requestedOrganizationId;
    } else {
      console.warn(
        `[HostResolution] ignoring x-vivd-organization-id="${requestedOrganizationId}" for user=${session.user.id} (no membership)`,
      );
    }
  }

  // Additional fallback for machine calls authenticated via bearer token:
  // when host-based routing cannot determine org (unknown/non-control-plane host),
  // use session active org or preferred membership org.
  if (!organizationId && session && bearerToken && !hostOrganizationId) {
    const activeOrganizationId = sessionRecordFromDb?.activeOrganizationId ?? null;
    const activeOrgAccessible = Boolean(
      activeOrganizationId &&
        (session.user.role === "super_admin" || membershipRoleByOrg.has(activeOrganizationId)),
    );
    const preferredOrganizationId = activeOrgAccessible
      ? activeOrganizationId
      : pickPreferredOrganizationId(memberships);

    if (preferredOrganizationId) {
      organizationId = preferredOrganizationId;
      if (
        sessionRecordFromDb &&
        sessionRecordFromDb.activeOrganizationId !== preferredOrganizationId
      ) {
        await db
          .update(sessionTable)
          .set({ activeOrganizationId: preferredOrganizationId })
          .where(eq(sessionTable.id, sessionRecordFromDb.id));
      }
    }
  }

  // If an org is selected from session state but user no longer belongs to it,
  // clear it (except for host-forced tenant domains).
  if (
    session &&
    session.user.role !== "super_admin" &&
    canUseSessionSelectedOrganization &&
    organizationId &&
    !membershipRoleByOrg.has(organizationId)
  ) {
    organizationId = null;
  }

  // Fallback: pick a preferred org whenever none is selected.
  // We allow this on:
  // - control-plane hosts (session-selected org)
  // - unknown hosts (escape hatch so a misconfigured host can’t hard-fail all orgProcedure calls)
  if (!organizationId && session && canUseSessionSelectedOrganization) {
    const preferredOrganizationId = pickPreferredOrganizationId(memberships);
    if (preferredOrganizationId) {
      organizationId = preferredOrganizationId;
      if (
        canSelectOrganization &&
        sessionRecordFromDb &&
        sessionRecordFromDb.activeOrganizationId !== preferredOrganizationId
      ) {
        await db
          .update(sessionTable)
          .set({ activeOrganizationId: preferredOrganizationId })
          .where(eq(sessionTable.id, sessionRecordFromDb.id));
      }
    }
  }

  if (!organizationId && studioRuntimeAuth) {
    organizationId = studioRuntimeAuth.organizationId;
  }

  const organizationRole =
    session && organizationId && session.user.role !== "super_admin"
      ? membershipRoleByOrg.get(organizationId) ?? null
      : null;

  const hostResolutionSignature = [
    resolvedHost.requestHost ?? "none",
    resolvedHost.hostKind,
    hostOrganizationId ?? "none",
    organizationId ?? "none",
    String(canSelectOrganization),
  ].join("|");

  if (resolvedHost.requestHost && shouldLogHostResolution(hostResolutionSignature)) {
    console.info(
      `[HostResolution] host=${resolvedHost.requestHost} kind=${resolvedHost.hostKind} hostOrg=${hostOrganizationId ?? "none"} org=${organizationId ?? "none"} canSelect=${canSelectOrganization}`,
    );
  }

  return {
    req,
    res,
    session,
    requestHost: resolvedHost.requestHost,
    requestDomain: resolvedHost.requestDomain,
    isSuperAdminHost: resolvedHost.isSuperAdminHost,
    hostKind: resolvedHost.hostKind,
    hostOrganizationId,
    hostOrganizationSlug: resolvedHost.hostOrganizationSlug,
    canSelectOrganization,
    organizationId,
    organizationRole,
    studioRuntimeAuth,
  };
};

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async function isAuthed(
  opts
) {
  const { ctx } = opts;
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return opts.next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

const enforceStudioOrganizationAccess = t.middleware(async ({ ctx, next }) => {
  const session = ctx.session;
  if (session) {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "No organization selected",
      });
    }
    if (session.user.role !== "super_admin") {
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, ctx.organizationId),
        columns: { status: true },
      });
      if (org?.status === "suspended") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Organization is suspended",
        });
      }

      if (!ctx.organizationRole) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not a member of this organization",
        });
      }
    }
    return next();
  }

  if (!ctx.organizationId || !ctx.studioRuntimeAuth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  if (ctx.organizationId !== ctx.studioRuntimeAuth.organizationId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Studio runtime is not authorized for this organization",
    });
  }

  return next();
});

const enforceOrganizationAccess = t.middleware(async ({ ctx, next }) => {
  const session = ctx.session;
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!ctx.organizationId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No organization selected",
    });
  }
  if (session.user.role !== "super_admin") {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, ctx.organizationId),
      columns: { status: true },
    });
    if (org?.status === "suspended") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Organization is suspended",
      });
    }

    if (!ctx.organizationRole) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You are not a member of this organization",
      });
    }
  }
  return next();
});

export const orgProcedure = protectedProcedure.use(enforceOrganizationAccess);
export const studioOrgProcedure = t.procedure.use(enforceStudioOrganizationAccess);

export const orgAdminProcedure = orgProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.user.role === "super_admin") return next();
  if (ctx.organizationRole !== "owner" && ctx.organizationRole !== "admin") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Organization admin access required",
    });
  }
  return next();
});

const enforceSuperAdminHost = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.session.user.role !== "super_admin") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Super-admin access required",
    });
  }

  if (!ctx.isSuperAdminHost) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Super-admin panel not available on this host",
    });
  }

  return next();
});

export const superAdminProcedure = protectedProcedure.use(enforceSuperAdminHost);

const projectSlugSchema = z.object({ slug: z.string().min(1) });
const studioProjectScopeSchema = z.object({
  studioId: z.string().min(1).optional(),
  slug: z.string().min(1),
  version: z.number().int().positive().optional(),
});
const enforceClientEditorProjectAccess = t.middleware(
  async ({ ctx, getRawInput, next }) => {
    if (!ctx.session) return next();
    if (ctx.organizationRole !== "client_editor") return next();

    if (!ctx.organizationId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const rawInput = await getRawInput();
    const parsed = projectSlugSchema.safeParse(rawInput);
    if (!parsed.success) return next();

    const membership = await db.query.projectMember.findFirst({
      where: and(
        eq(projectMember.organizationId, ctx.organizationId),
        eq(projectMember.userId, ctx.session.user.id),
      ),
    });
    const assignedProjectSlug = membership?.projectSlug ?? null;

    if (!assignedProjectSlug) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "No project assigned to your account",
      });
    }

    if (parsed.data.slug !== assignedProjectSlug) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You are not allowed to access this project",
      });
    }

    return next();
  }
);

const enforceStudioProjectAccess = t.middleware(async ({ ctx, getRawInput, next }) => {
  if (ctx.session) return next();

  if (!ctx.studioRuntimeAuth) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const rawInput = await getRawInput();
  const parsed = studioProjectScopeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Studio runtime project scope is invalid",
    });
  }

  if (
    parsed.data.studioId &&
    parsed.data.studioId !== ctx.studioRuntimeAuth.studioId
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Studio runtime id mismatch",
    });
  }

  if (parsed.data.slug !== ctx.studioRuntimeAuth.projectSlug) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Studio runtime is not authorized for this project",
    });
  }

  if (
    parsed.data.version &&
    parsed.data.version !== ctx.studioRuntimeAuth.version
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Studio runtime is not authorized for this project version",
    });
  }

  return next();
});

// Project-scoped access: for client_editors, requires an assigned project and enforces slug match.
export const projectMemberProcedure = orgProcedure.use(
  enforceClientEditorProjectAccess
);
export const studioProjectProcedure = studioOrgProcedure
  .use(enforceClientEditorProjectAccess)
  .use(enforceStudioProjectAccess);

export const adminProcedure = orgProcedure.use(
  async function isTeamMember(opts) {
    const { ctx } = opts;
    // Team-level: blocks client_editors (allows admin + user)
    if (ctx.organizationRole === "client_editor") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "This feature is not available for your account",
      });
    }
    return opts.next();
  }
);

// Legacy name: previously meant "admin/owner" in single-tenant mode.
// In multi-tenant mode, this is super-admin only (host-gated).
export const ownerProcedure = superAdminProcedure;
