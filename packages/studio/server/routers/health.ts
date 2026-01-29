import { router, publicProcedure } from "../trpc/trpc.js";

export const healthRouter = router({
  check: publicProcedure.query(async ({ ctx }) => {
    return {
      status: "ok",
      initialized: ctx.workspace.isInitialized(),
      projectPath: ctx.workspace.isInitialized()
        ? ctx.workspace.getProjectPath()
        : null,
    };
  }),
});
