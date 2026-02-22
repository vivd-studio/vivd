import { router } from "./trpc.js";
import { editRouter } from "../trpcRouters/edit.js";
import { previewRouter } from "../trpcRouters/preview.js";
import { gitRouter } from "../trpcRouters/git.js";
import { assetsRouter } from "../trpcRouters/assets.js";
import { healthRouter } from "../trpcRouters/health.js";
import { projectRouter } from "../trpcRouters/project.js";
import { agentRouter } from "../trpcRouters/agent.js";
import { usageRouter } from "../trpcRouters/usage.js";

export const appRouter = router({
  edit: editRouter,
  preview: previewRouter,
  git: gitRouter,
  assets: assetsRouter,
  health: healthRouter,
  project: projectRouter,
  agent: agentRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
