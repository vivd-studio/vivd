import { protectedProcedure, router } from "../trpc";

/**
 * Configuration router to expose app settings to the frontend.
 * This enables features like single project mode to be controlled via env vars.
 */
export const configRouter = router({
  /**
   * Get app configuration settings.
   * These settings control application-wide behavior like single project mode.
   */
  getAppConfig: protectedProcedure.query(({ ctx }) => {
    return {
      // Single project mode: when true, the app operates with a single project
      // and bypasses the project list/dashboard view
      singleProjectMode: process.env.SINGLE_PROJECT_MODE === "true",
      // Whether the current request host is allowed to access the super-admin panel.
      isSuperAdminHost: ctx.isSuperAdminHost,
      // When true, the user can switch orgs via session state.
      // On tenant domains (published domains), org context is pinned to the host.
      canSelectOrganization: !ctx.hostOrganizationId,
    };
  }),
});
