import { router } from "../trpc";
import { projectGenerationProcedures } from "./project/generation";
import { projectGitProcedures } from "./project/git";
import { projectPublishProcedures } from "./project/publish";
import { projectMaintenanceProcedures } from "./project/maintenance";
import { previewProcedures } from "./project/preview";
import { studioProcedures } from "./project/studio";

export const projectRouter = router({
  ...projectGenerationProcedures,
  ...projectGitProcedures,
  ...projectPublishProcedures,
  ...projectMaintenanceProcedures,
  ...previewProcedures,
  ...studioProcedures,
});
