import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "../db";
import {
  organization,
  projectMember,
} from "../db/schema";
import { and, eq } from "drizzle-orm";
import {
  studioLifecycleGuardService,
  type StudioLifecycleAction,
} from "../services/system/StudioLifecycleGuardService";
import { controlPlaneRateLimitService } from "../services/system/ControlPlaneRateLimitService";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async function isAuthed(opts) {
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

function extractStudioUserActionScope(
  rawInput: unknown,
): { slug: string | null; version: number | null } {
  if (!rawInput || typeof rawInput !== "object") {
    return { slug: null, version: null };
  }

  const record = rawInput as Record<string, unknown>;
  const slugCandidates = [record.slug, record.projectSlug, record.oldSlug];
  const versionCandidates = [record.version, record.projectVersion];

  const slug =
    slugCandidates.find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )?.trim() ?? null;
  const version =
    versionCandidates.find(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    ) ?? null;

  return {
    slug,
    version: version != null ? Math.trunc(version) : null,
  };
}

const enforceClientEditorProjectAccess = t.middleware(async ({ ctx, getRawInput, next }) => {
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
});

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

const enforceStudioUserActionProjectAccess = t.middleware(
  async ({ ctx, getRawInput, next }) => {
    if (!ctx.studioUserActionAuth) return next();

    const rawInput = await getRawInput();
    const scope = extractStudioUserActionScope(rawInput);

    if (!scope.slug) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Studio user action token is not authorized for this procedure",
      });
    }

    if (scope.slug !== ctx.studioUserActionAuth.projectSlug) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Studio user action token is not authorized for this project",
      });
    }

    if (
      scope.version != null &&
      scope.version > 0 &&
      scope.version !== ctx.studioUserActionAuth.version
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Studio user action token is not authorized for this project version",
      });
    }

    return next();
  },
);

function createStudioLifecycleGuardMiddleware(action: StudioLifecycleAction) {
  return t.middleware(async ({ ctx, getRawInput, next }) => {
    const rawInput = await getRawInput();
    const scope = extractStudioUserActionScope(rawInput);
    const decision = studioLifecycleGuardService.checkAction({
      action,
      organizationId: ctx.organizationId,
      projectSlug: scope.slug,
      requestIp: ctx.requestIp,
      userId: ctx.session?.user.id ?? ctx.studioUserActionAuth?.userId ?? null,
      version: scope.version,
    });

    if (!decision.allowed) {
      if (decision.retryAfterSeconds > 0) {
        ctx.res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      }
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          action === "touchStudio"
            ? "Studio keepalive budget exceeded. Please wait a moment and retry."
            : "Studio lifecycle budget exceeded. Please wait a moment and retry.",
      });
    }

    return next();
  });
}

function createControlPlaneRateLimitMiddleware(options: {
  action: "project_generation" | "project_publish";
  message: string;
}) {
  return t.middleware(async ({ ctx, next }) => {
    const decision = await controlPlaneRateLimitService.checkAction({
      action: options.action,
      organizationId: ctx.organizationId,
      requestIp: ctx.requestIp,
      userId: ctx.session?.user.id ?? null,
    });

    if (!decision.allowed) {
      if (decision.retryAfterSeconds > 0) {
        ctx.res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      }
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: options.message,
      });
    }

    return next();
  });
}

// Project-scoped access: for client_editors, requires an assigned project and enforces slug match.
export const projectMemberProcedure = orgProcedure.use(
  enforceClientEditorProjectAccess,
).use(
  enforceStudioUserActionProjectAccess,
);
export const studioStartProcedure = projectMemberProcedure.use(
  createStudioLifecycleGuardMiddleware("startStudio"),
);
export const studioHardRestartProcedure = projectMemberProcedure.use(
  createStudioLifecycleGuardMiddleware("hardRestartStudio"),
);
export const studioTouchProcedure = projectMemberProcedure.use(
  createStudioLifecycleGuardMiddleware("touchStudio"),
);
export const studioProjectProcedure = studioOrgProcedure
  .use(enforceClientEditorProjectAccess)
  .use(enforceStudioProjectAccess);

export const teamMemberProcedure = orgProcedure.use(
  enforceStudioUserActionProjectAccess,
).use(
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
  },
);
export const projectAdminProcedure = orgAdminProcedure.use(
  enforceStudioUserActionProjectAccess,
);
// Legacy alias: this procedure allows any non-client-editor team member.
// Prefer `projectAdminProcedure` or `orgAdminProcedure` for new privileged mutations.
export const adminProcedure = teamMemberProcedure;
export const generationProcedure = adminProcedure.use(
  createControlPlaneRateLimitMiddleware({
    action: "project_generation",
    message: "Generation budget exceeded. Please wait a moment and retry.",
  }),
);
export const publishMutationProcedure = projectMemberProcedure.use(
  createControlPlaneRateLimitMiddleware({
    action: "project_publish",
    message: "Publish budget exceeded. Please wait a moment and retry.",
  }),
);

// Legacy name: previously meant "admin/owner" in single-tenant mode.
// In multi-tenant mode, this is super-admin only (host-gated).
export const ownerProcedure = superAdminProcedure;
