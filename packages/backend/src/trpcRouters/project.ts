import { router } from "../trpc";
import { projectGenerationProcedures } from "./project/generation";
import { projectPublishProcedures } from "./project/publish";
import { projectMaintenanceProcedures } from "./project/maintenance";
import { previewProcedures } from "./project/preview";
import { studioProcedures } from "./project/studio";
import { projectTagProcedures } from "./project/tags";

export const projectRouter = router({
  ...projectGenerationProcedures,
  ...projectPublishProcedures,
  ...projectMaintenanceProcedures,
  ...previewProcedures,
  ...studioProcedures,
  ...projectTagProcedures,
});
