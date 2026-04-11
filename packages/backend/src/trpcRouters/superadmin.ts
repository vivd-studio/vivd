import { router } from "../trpc";
import { emailSuperAdminProcedures } from "./superadmin.email";
import { instanceSuperAdminProcedures } from "./superadmin.instance";
import { organizationSuperAdminProcedures } from "./superadmin.organizations";
import { pluginsSuperAdminProcedures } from "./superadmin.plugins";
import { studioMachinesSuperAdminProcedures } from "./superadmin.studioMachines";

export const superAdminRouter = router({
  ...instanceSuperAdminProcedures,
  ...studioMachinesSuperAdminProcedures,
  ...organizationSuperAdminProcedures,
  ...pluginsSuperAdminProcedures,
  ...emailSuperAdminProcedures,
});
