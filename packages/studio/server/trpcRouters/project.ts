import { router } from "../trpc/trpc.js";
import { previewProjectProcedures } from "./project.preview.js";
import { projectGitProcedures } from "./project/git.js";
import { projectGitHubSyncProcedures } from "./project/githubSync.js";
import { projectListProcedures } from "./project/list.js";
import { projectPublishProcedures } from "./project/publish.js";

export const projectRouter = router({
  ...projectListProcedures,
  ...previewProjectProcedures,
  ...projectGitProcedures,
  ...projectPublishProcedures,
  ...projectGitHubSyncProcedures,
});
