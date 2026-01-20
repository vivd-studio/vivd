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

  // Main app (inside layout)
  DASHBOARD: "/vivd-studio",
  SETTINGS: "/vivd-studio/settings",
  ADMIN: "/vivd-studio/admin",
  NO_PROJECT: "/vivd-studio/no-project",

  // Single project mode (outside layout)
  SINGLE_PROJECT: "/vivd-studio/single-project",

  // Projects
  PROJECT: (slug: string) => `/vivd-studio/projects/${slug}` as const,
  PROJECT_FULLSCREEN: (slug: string) =>
    `/vivd-studio/projects/${slug}/fullscreen` as const,
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
