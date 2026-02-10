import { initTRPC, TRPCError } from "@trpc/server";
import * as trpcExpress from "@trpc/server/adapters/express";
import { getSession } from "./lib/authProvider";
import { z } from "zod";
import { db } from "./db";
import {
  organization,
  organizationMember,
  projectMember,
  publishedSite,
  session as sessionTable,
} from "./db/schema";
import { and, asc, eq } from "drizzle-orm";

type UserMembership = {
  organizationId: string;
  role: string;
};

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

function getRequestHost(req: trpcExpress.CreateExpressContextOptions["req"]): string | null {
  const raw = req.headers.host;
  if (!raw) return null;

  const first = raw.split(",")[0]?.trim();
  if (!first) return null;

  try {
    return new URL(`http://${first}`).hostname.toLowerCase();
  } catch {
    return first.toLowerCase();
  }
}

function normalizeDomainForLookup(host: string): string {
  const normalized = host.toLowerCase();
  return normalized.startsWith("www.") ? normalized.slice("www.".length) : normalized;
}

function getEnvHostname(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return new URL(trimmed).hostname.toLowerCase();
    }
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getSuperAdminHosts(): Set<string> {
  const hosts = new Set<string>();

  const raw = process.env.SUPERADMIN_HOSTS?.trim();
  if (raw) {
    raw
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean)
      .forEach((h) => {
        const host = getEnvHostname(h) ?? h.toLowerCase();
        hosts.add(normalizeDomainForLookup(host));
      });
  } else {
    const domainHost = getEnvHostname(process.env.DOMAIN) ?? "localhost";
    hosts.add(normalizeDomainForLookup(domainHost));
    hosts.add("localhost");
    hosts.add("127.0.0.1");
  }

  return hosts;
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
  const requestHost = getRequestHost(req);
  const requestDomain = requestHost ? normalizeDomainForLookup(requestHost) : null;
  const isSuperAdminHost = requestHost
    ? getSuperAdminHosts().has(normalizeDomainForLookup(requestHost))
    : false;

  // Fallback for machine-to-backend calls (e.g. Studio UsageReporter):
  // allow `Authorization: Bearer <session.token>` in addition to cookie-based sessions.
  let sessionRecordFromDb: { id: string; activeOrganizationId: string | null } | null = null;
  if (!session) {
    const authHeader = headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (bearer) {
      const sessionRecord = await db.query.session.findFirst({
        where: eq(sessionTable.token, bearer),
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

  // Domain-based tenant resolution should only apply on tenant domains, not on the
  // super-admin host (e.g. `localhost` / main `DOMAIN`). Otherwise publishing a site
  // on the main host would "pin" the studio to that tenant.
  const hostOrg =
    requestDomain && !isSuperAdminHost
      ? await db.query.publishedSite.findFirst({
          where: eq(publishedSite.domain, requestDomain),
          columns: { organizationId: true },
        })
      : null;
  const hostOrganizationId = hostOrg?.organizationId ?? null;

  let organizationId =
    hostOrganizationId ?? sessionRecordFromDb?.activeOrganizationId ?? null;

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

  // If an org is selected from session state but user no longer belongs to it,
  // clear it (except for host-forced tenant domains).
  if (
    session &&
    session.user.role !== "super_admin" &&
    !hostOrganizationId &&
    organizationId &&
    !membershipRoleByOrg.has(organizationId)
  ) {
    organizationId = null;
  }

  // Fallback: pick a preferred org whenever none is selected.
  if (!organizationId && session) {
    const preferredOrganizationId = pickPreferredOrganizationId(memberships);
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

  const organizationRole =
    session && organizationId && session.user.role !== "super_admin"
      ? membershipRoleByOrg.get(organizationId) ?? null
      : null;

  return {
    req,
    res,
    session,
    requestHost,
    isSuperAdminHost,
    organizationId,
    organizationRole,
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

const enforceOrganizationAccess = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!ctx.organizationId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No organization selected",
    });
  }
  if (ctx.session.user.role === "super_admin") {
    return next();
  }

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
  return next();
});

export const orgProcedure = protectedProcedure.use(enforceOrganizationAccess);

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

// Project-scoped access: for client_editors, requires an assigned project and enforces slug match.
export const projectMemberProcedure = orgProcedure.use(
  enforceClientEditorProjectAccess
);

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
