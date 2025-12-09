import { router } from "../trpc";
import { userRouter } from "./user";
import { projectRouter } from "./project";

export const appRouter = router({
    user: userRouter,
    project: projectRouter,
});

export type AppRouter = typeof appRouter;
