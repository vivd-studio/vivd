import { router } from "../trpc";
import { userRouter } from "./user";
import { projectRouter } from "./project";
import { agentRouter } from "./agent";
import { assetsRouter } from "./assetsRouter";
import { configRouter } from "./config";
import { usageRouter } from "./usage";
import { studioApiRouter } from "./studioApi";

export const appRouter = router({
  user: userRouter,
  project: projectRouter,
  agent: agentRouter,
  assets: assetsRouter,
  config: configRouter,
  usage: usageRouter,
  studioApi: studioApiRouter,
});

export type AppRouter = typeof appRouter;
