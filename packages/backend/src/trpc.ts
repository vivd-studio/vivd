import { initTRPC, TRPCError } from "@trpc/server";
import * as trpcExpress from "@trpc/server/adapters/express";
import { getSession } from "./lib/authProvider";
import { z } from "zod";
import { db } from "./db";
import { projectMember } from "./db/schema";
import { eq } from "drizzle-orm";

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

  const session = await getSession(headers);

  return {
    req,
    res,
    session,
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
      session: ctx.session,
    },
  });
});

const projectSlugSchema = z.object({ slug: z.string().min(1) });
const enforceClientEditorProjectAccess = t.middleware(
  async ({ ctx, getRawInput, next }) => {
  if (!ctx.session) return next();
  if (ctx.session.user.role !== "client_editor") return next();

  const rawInput = await getRawInput();
  const parsed = projectSlugSchema.safeParse(rawInput);
  if (!parsed.success) return next();

  const membership = await db.query.projectMember.findFirst({
    where: eq(projectMember.userId, ctx.session.user.id),
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
export const projectMemberProcedure = protectedProcedure.use(
  enforceClientEditorProjectAccess
);

export const adminProcedure = protectedProcedure.use(
  async function isTeamMember(opts) {
    const { ctx } = opts;
    // Team-level: blocks client_editors (allows admin + user)
    if (ctx.session.user.role === "client_editor") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "This feature is not available for your account",
      });
    }
    return opts.next();
  }
);

export const ownerProcedure = protectedProcedure.use(async function isOwner(
  opts
) {
  const { ctx } = opts;
  // Owner-level: admin only (maintenance, user management)
  if (ctx.session.user.role !== "admin") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Admin access required",
    });
  }
  return opts.next();
});
