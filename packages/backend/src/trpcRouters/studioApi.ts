/**
 * Studio API Router
 *
 * Stable public facade for the connected Studio API. Implementation is split
 * into focused modules under `./studioApi/`.
 */

import { router } from "../trpc";
import { studioApiChecklistLeaseProcedures } from "./studioApi/checklistLease";
import { studioApiPreviewWorkspaceProcedures } from "./studioApi/previewWorkspace";
import { studioApiProjectPluginProcedures } from "./studioApi/projectPlugins";
import { studioApiUsageSessionProcedures } from "./studioApi/usageSession";

export const studioApiRouter = router({
  ...studioApiUsageSessionProcedures,
  ...studioApiProjectPluginProcedures,
  ...studioApiPreviewWorkspaceProcedures,
  ...studioApiChecklistLeaseProcedures,
});
