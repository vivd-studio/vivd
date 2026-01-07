import { router } from "../trpc";
import { projectGenerationProcedures } from "./project/generation";
import { projectGitProcedures } from "./project/git";
import { projectPublishProcedures } from "./project/publish";
import { projectMaintenanceProcedures } from "./project/maintenance";

export const projectRouter = router({
  ...projectGenerationProcedures,
  ...projectGitProcedures,
  ...projectPublishProcedures,
  ...projectMaintenanceProcedures,
});

