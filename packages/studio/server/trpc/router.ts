import { router } from "./trpc.js";
import { editRouter } from "../routers/edit.js";
import { previewRouter } from "../routers/preview.js";
import { gitRouter } from "../routers/git.js";
import { assetsRouter } from "../routers/assets.js";
import { healthRouter } from "../routers/health.js";
import { projectRouter } from "../routers/project.js";
import { agentRouter } from "../routers/agent.js";
import { usageRouter } from "../routers/usage.js";

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
