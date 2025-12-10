import { router } from "../trpc";
import { userRouter } from "./user";
import { projectRouter } from "./project";
import { agentRouter } from "./agent";

export const appRouter = router({
    user: userRouter,
    project: projectRouter,
    agent: agentRouter,
});

export type AppRouter = typeof appRouter;
