import { protectedProcedure, router } from "../trpc";
import { domainService } from "../services/publish/DomainService";

/**
 * Configuration router to expose app settings to the frontend.
 * This enables features like single project mode to be controlled via env vars.
 */
export const configRouter = router({
  /**
   * Get app configuration settings.
   * These settings control application-wide behavior like single project mode.
   */
  getAppConfig: protectedProcedure.query(async ({ ctx }) => {
    const preferredTenantBaseDomain = domainService.inferTenantBaseDomainFromHost(
      ctx.requestDomain,
    );
    const activeOrganizationTenantHost = ctx.organizationId
      ? await domainService.getActiveTenantHostForOrganization(ctx.organizationId, {
          preferredTenantBaseDomain,
        })
      : null;

    return {
      // Single project mode: when true, the app operates with a single project
      // and bypasses the project list/dashboard view
      singleProjectMode: process.env.SINGLE_PROJECT_MODE === "true",
      // Whether the current session belongs to a super-admin user.
      isSuperAdminUser: ctx.session.user.role === "super_admin",
      // Whether the current request host is allowed to access the super-admin panel.
      isSuperAdminHost: ctx.isSuperAdminHost,
      hostKind: ctx.hostKind,
      // When true, org selection is session-based (control-plane hosts).
      canSelectOrganization: ctx.canSelectOrganization,
      tenantHostOrgSlug: ctx.hostKind === "tenant_host" ? ctx.hostOrganizationSlug : null,
      hostOrganizationId: ctx.hostOrganizationId,
      hasHostOrganizationAccess:
        !ctx.hostOrganizationId ||
        ctx.session.user.role === "super_admin" ||
        Boolean(ctx.organizationRole),
      controlPlaneHost: domainService.getControlPlaneHostForRequest(ctx.requestDomain),
      activeOrganizationTenantHost,
    };
  }),
});
