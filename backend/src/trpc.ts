import { initTRPC, TRPCError } from '@trpc/server';
import * as trpcExpress from '@trpc/server/adapters/express';
import { auth } from './auth';

export const createContext = async ({
    req,
    res,
}: trpcExpress.CreateExpressContextOptions) => {
    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
            headers.append(key, value);
        } else if (Array.isArray(value)) {
            value.forEach(v => headers.append(key, v));
        }
    });

    const session = await auth.api.getSession({
        headers: headers,
    });

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

export const protectedProcedure = t.procedure.use(async function isAuthed(opts) {
    const { ctx } = opts;
    if (!ctx.session) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return opts.next({
        ctx: {
            session: ctx.session,
        },
    });
});

export const adminProcedure = protectedProcedure.use(async function isAdmin(opts) {
    const { ctx } = opts;
    if (ctx.session.user.role !== "admin") {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Admin access required",
        });
    }
    return opts.next();
});
