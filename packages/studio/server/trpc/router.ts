import { router } from "./trpc.js";
import { editRouter } from "../trpcRouters/edit.js";
import { gitRouter } from "../trpcRouters/git.js";
import { assetsRouter } from "../trpcRouters/assets.js";
import { cmsRouter } from "../trpcRouters/cms.js";
import { healthRouter } from "../trpcRouters/health.js";
import { projectRouter } from "../trpcRouters/project.js";
import { agentRouter } from "../trpcRouters/agent.js";
import { agentChatRouter } from "../trpcRouters/agentChat.js";
import { usageRouter } from "../trpcRouters/usage.js";

export const appRouter = router({
  edit: editRouter,
  git: gitRouter,
  assets: assetsRouter,
  cms: cmsRouter,
  health: healthRouter,
  project: projectRouter,
  agent: agentRouter,
  agentChat: agentChatRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
