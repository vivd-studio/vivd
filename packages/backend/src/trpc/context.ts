import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { getSession } from "../lib/authProvider";
import { extractRequestIp } from "../lib/requestClientIp";
import { db } from "../db";
import { STUDIO_USER_ACTION_TOKEN_HEADER } from "@vivd/shared/studio";
import {
  organizationMember,
  session as sessionTable,
} from "../db/schema";
import { asc, eq } from "drizzle-orm";
import { domainService } from "../services/publish/DomainService";
import { normalizeOrganizationId } from "../lib/organizationIdentifiers";
import { studioMachineProvider } from "../services/studioMachines";
import type { StudioRuntimeAuthIdentity } from "../services/studioMachines/types";
import { trafficSurfaceService } from "../services/system/TrafficSurfaceService";
import {
  verifyStudioUserActionToken,
  type VerifiedStudioUserActionToken,
} from "../lib/studioUserActionToken";

type UserMembership = {
  organizationId: string;
  role: string;
};

type StudioUserActionAuthIdentity = VerifiedStudioUserActionToken;

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

function readForwardedHost(value: string | string[] | undefined): string | null {
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

function extractRequestHost(req: CreateExpressContextOptions["req"]): string | null {
  const forwarded = readForwardedHost(req.headers["x-forwarded-host"]);
  if (forwarded) return forwarded;

  const host = readForwardedHost(req.headers.host);
  if (host) return host;
  return null;
}

function extractRequestProtocol(
  req: CreateExpressContextOptions["req"],
): string | null {
  const forwarded = readForwardedHost(req.headers["x-forwarded-proto"]);
  if (forwarded) return forwarded.toLowerCase();

  if (typeof req.protocol === "string" && req.protocol.trim()) {
    return req.protocol.trim().toLowerCase();
  }

  return null;
}

export const createContext = async ({
  req,
  res,
}: CreateExpressContextOptions) => {
  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (typeof value === "string") {
      headers.append(key, value);
    } else if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    }
  });

  let session = await getSession(headers);
  const requestHost = extractRequestHost(req);
  const requestPath = (() => {
    const rawUrl = typeof req.url === "string" ? req.url : "";
    if (!rawUrl) return "/";
    try {
      return new URL(rawUrl, "http://vivd.local").pathname || "/";
    } catch {
      return rawUrl.split("?")[0] || "/";
    }
  })();
  const resolvedHost = await domainService.resolveHost(requestHost);
  const requestedOrganizationId = normalizeOrganizationId(
    headers.get("x-vivd-organization-id"),
  );
  const authHeader = headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  const studioRuntimeToken = headers.get(STUDIO_RUNTIME_TOKEN_HEADER)?.trim() || null;
  const studioRuntimeId = headers.get(STUDIO_RUNTIME_ID_HEADER)?.trim() || null;
  const studioUserActionToken =
    headers.get(STUDIO_USER_ACTION_TOKEN_HEADER)?.trim() || null;

  // Fallback for machine-to-backend calls (e.g. Studio UsageReporter):
  // allow `Authorization: Bearer <session.token>` in addition to cookie-based sessions.
  let sessionRecordFromDb: { id: string; activeOrganizationId: string | null } | null = null;
  if (!session && bearerToken) {
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

  let studioUserActionAuth: StudioUserActionAuthIdentity | null = null;
  if (!session && studioUserActionToken) {
    const verified = verifyStudioUserActionToken(studioUserActionToken);
    if (verified) {
      const sessionRecord = await db.query.session.findFirst({
        where: eq(sessionTable.id, verified.sessionId),
        with: {
          user: true,
        },
      });

      if (
        sessionRecord &&
        sessionRecord.userId === verified.userId &&
        (!sessionRecord.expiresAt || new Date(sessionRecord.expiresAt) > new Date())
      ) {
        sessionRecordFromDb = {
          id: sessionRecord.id,
          activeOrganizationId: verified.organizationId,
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
        studioUserActionAuth = verified;
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

  if (studioUserActionAuth) {
    organizationId = studioUserActionAuth.organizationId;
  }

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

  if (studioUserActionAuth && requestedOrganizationId && !hostOrganizationId) {
    if (requestedOrganizationId !== studioUserActionAuth.organizationId) {
      console.warn(
        `[HostResolution] ignoring x-vivd-organization-id="${requestedOrganizationId}" for studio user action token org=${studioUserActionAuth.organizationId}`,
      );
    }
  } else if (studioRuntimeAuth && requestedOrganizationId) {
    if (requestedOrganizationId === studioRuntimeAuth.organizationId) {
      organizationId = requestedOrganizationId;
    } else {
      console.warn(
        `[HostResolution] ignoring x-vivd-organization-id="${requestedOrganizationId}" for studio runtime org=${studioRuntimeAuth.organizationId}`,
      );
    }
  } else if (session && requestedOrganizationId && !hostOrganizationId) {
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

  const trafficSurface = trafficSurfaceService.classifyRequest({
    hostKind: resolvedHost.hostKind,
    requestHost,
    requestPath,
    controlPlaneHost:
      resolvedHost.hostKind === "control_plane_host" ? resolvedHost.requestDomain : null,
  });

  return {
    req,
    res,
    session,
    requestIp: extractRequestIp(req),
    requestHost: resolvedHost.requestHost,
    requestProtocol: extractRequestProtocol(req),
    requestDomain: resolvedHost.requestDomain,
    isSuperAdminHost: resolvedHost.isSuperAdminHost,
    hostKind: resolvedHost.hostKind,
    hostOrganizationId,
    hostOrganizationSlug: resolvedHost.hostOrganizationSlug,
    canSelectOrganization,
    organizationId,
    organizationRole,
    studioRuntimeAuth,
    studioUserActionAuth,
    trafficSurface,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
