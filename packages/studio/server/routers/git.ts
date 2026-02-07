import { z } from "zod";
import { router, publicProcedure } from "../trpc/trpc.js";

export const gitRouter = router({
  status: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.workspace.isInitialized()) {
      return {
        hasChanges: false,
        staged: [],
        modified: [],
        untracked: [],
      };
    }

    const hasChanges = await ctx.workspace.hasChanges();
    const status = await ctx.workspace.getStatus();

    return {
      hasChanges,
      ...status,
    };
  }),

  save: publicProcedure
    .input(
      z.object({
        message: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return { success: false, error: "Workspace not initialized" };
      }

      try {
        const message = input.message || `Edit from Vivd Studio`;
        const commitHash = await ctx.workspace.commit(message);

        if (!commitHash) {
          return { success: true, message: "No changes to commit" };
        }

        return { success: true, commitHash };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  discard: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.workspace.isInitialized()) {
      return { success: false, error: "Workspace not initialized" };
    }

    try {
      await ctx.workspace.discardChanges();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }),

  history: publicProcedure
    .input(
      z
        .object({
          limit: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspace.isInitialized()) {
        return [];
      }

      return ctx.workspace.getHistory(input?.limit || 10);
    }),
});
