import { organizationDomainSuperAdminProcedures } from "./superadminOrganizations/domains";
import { organizationInvitationSuperAdminProcedures } from "./superadminOrganizations/invitations";
import { organizationMemberSuperAdminProcedures } from "./superadminOrganizations/members";
import { organizationOverviewSuperAdminProcedures } from "./superadminOrganizations/overview";
import { organizationUserCreationSuperAdminProcedures } from "./superadminOrganizations/users";

export const organizationSuperAdminProcedures = {
  ...organizationOverviewSuperAdminProcedures,
  ...organizationMemberSuperAdminProcedures,
  ...organizationInvitationSuperAdminProcedures,
  ...organizationDomainSuperAdminProcedures,
  ...organizationUserCreationSuperAdminProcedures,
};
