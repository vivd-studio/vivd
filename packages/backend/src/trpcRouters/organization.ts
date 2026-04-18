import { router } from "../trpc";
import { organizationInvitationProcedures } from "./organization/invitations";
import { organizationMembershipProcedures } from "./organization/members";
import { organizationOverviewProcedures } from "./organization/overview";
import { organizationPluginOverviewProcedures } from "./organization/plugins";

export const organizationRouter = router({
  ...organizationMembershipProcedures,
  ...organizationOverviewProcedures,
  ...organizationPluginOverviewProcedures,
  ...organizationInvitationProcedures,
});
