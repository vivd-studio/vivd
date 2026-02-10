import { router } from "../trpc";
import { userRouter } from "./user";
import { projectRouter } from "./project";
import { configRouter } from "./config";
import { usageRouter } from "./usage";
import { studioApiRouter } from "./studioApi";
import { superAdminRouter } from "./superadmin";
import { organizationRouter } from "./organization";

export const appRouter = router({
  user: userRouter,
  project: projectRouter,
  config: configRouter,
  usage: usageRouter,
  studioApi: studioApiRouter,
  organization: organizationRouter,
  superadmin: superAdminRouter,
});

export type AppRouter = typeof appRouter;
