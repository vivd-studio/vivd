import { projectMaintenanceConfigAndExportProcedures } from "./maintenance/configAndExport";
import { projectMaintenanceDestructiveProcedures } from "./maintenance/destructive";
import { projectMaintenanceMigrationProcedures } from "./maintenance/migrations";
import { projectMaintenanceStatusAndIdentityProcedures } from "./maintenance/statusAndIdentity";
import { projectMaintenanceThumbnailProcedures } from "./maintenance/thumbnails";

export const projectMaintenanceProcedures = {
  ...projectMaintenanceStatusAndIdentityProcedures,
  ...projectMaintenanceMigrationProcedures,
  ...projectMaintenanceConfigAndExportProcedures,
  ...projectMaintenanceDestructiveProcedures,
  ...projectMaintenanceThumbnailProcedures,
};
