import { publicProcedure, router } from "../trpc";
import { db } from "../db";

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
});
