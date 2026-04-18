/**
 * Centralized route path constants.
 *
 * Use these instead of hardcoded strings to:
 * - Avoid typos in route paths
 * - Make route changes easier (single place to update)
 * - Enable IDE autocomplete and refactoring
 */

export const ROUTES = {
  // Base
  ROOT: "/",
  STUDIO_BASE: "/vivd-studio",

  // Auth
  LOGIN: "/vivd-studio/login",
  FORGOT_PASSWORD: "/vivd-studio/forgot-password",
  RESET_PASSWORD: "/vivd-studio/reset-password",
  INVITE_ACCEPT: "/vivd-studio/invite",

  // Main app (inside layout)
  DASHBOARD: "/vivd-studio",
  SETTINGS: "/vivd-studio/settings",
  ORG: "/vivd-studio/org",
  SUPERADMIN_BASE: "/vivd-studio/superadmin",
  SUPERADMIN_ORGS: "/vivd-studio/superadmin/orgs",
  SUPERADMIN_USERS: "/vivd-studio/superadmin/users",
  SUPERADMIN_USAGE: "/vivd-studio/superadmin/usage",
  SUPERADMIN_MAINTENANCE: "/vivd-studio/superadmin/maintenance",
  SUPERADMIN_MACHINES: "/vivd-studio/superadmin/machines",
  NO_PROJECT: "/vivd-studio/no-project",

  // Single project mode (outside layout)
  SINGLE_PROJECT: "/vivd-studio/single-project",

  // Projects
  PROJECT: (slug: string) => `/vivd-studio/projects/${slug}` as const,
  PROJECT_PLUGINS: (slug: string) =>
    `/vivd-studio/projects/${slug}/plugins` as const,
  PROJECT_PLUGIN: (slug: string, pluginId: string, subpath?: string) =>
    `/vivd-studio/projects/${slug}/plugins/${pluginId}${
      subpath ? `/${subpath.replace(/^\/+/, "")}` : ""
    }` as const,
  PROJECT_FULLSCREEN: (slug: string) =>
    `/vivd-studio/projects/${slug}/fullscreen` as const,
  PROJECT_STUDIO_FULLSCREEN: (slug: string) =>
    `/vivd-studio/projects/${slug}/studio-fullscreen` as const,
  NEW_SCRATCH: "/vivd-studio/projects/new/scratch",

  // API endpoints
  API_TRPC: "/vivd-studio/api/trpc",
  API_DOWNLOAD: (slug: string, version: number) =>
    `/vivd-studio/api/download/${slug}/${version}` as const,
} as const;

/**
 * Helper to check if a path starts with a given route prefix.
 */
export function isRoutePrefix(pathname: string, route: string): boolean {
  return pathname.startsWith(route);
}
