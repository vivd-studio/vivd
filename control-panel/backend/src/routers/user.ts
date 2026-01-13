import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { db } from "../db/index.js";

export const userRouter = router({
  hasUsers: publicProcedure.query(async () => {
    try {
      const user = await db.query.user.findFirst();
      return { hasUsers: !!user };
    } catch (error) {
      console.error("Failed to check users:", error);
      return { hasUsers: false };
    }
  }),

  me: protectedProcedure.query(({ ctx }) => {
    return { user: ctx.session.user };
  }),
});

