import { router } from "../trpc";
import { emailSuperAdminProcedures } from "./superadmin.email";
import { instanceSuperAdminProcedures } from "./superadmin.instance";
import { experimentalInstanceSuperAdminProcedures } from "./superadmin.instanceExperimental";
import { organizationSuperAdminProcedures } from "./superadmin.organizations";
import { pluginsSuperAdminProcedures } from "./superadmin.plugins";
import { studioMachinesSuperAdminProcedures } from "./superadmin.studioMachines";

export const superAdminRouter = router({
  ...instanceSuperAdminProcedures,
  ...experimentalInstanceSuperAdminProcedures,
  ...studioMachinesSuperAdminProcedures,
  ...organizationSuperAdminProcedures,
  ...pluginsSuperAdminProcedures,
  ...emailSuperAdminProcedures,
});
