/**
 * Canonical list of project actions shared between the dashboard (ProjectCard)
 * and the studio (QuickActions / MobileActionsMenu).
 *
 * When you add or remove an action, update both UIs so they stay in sync.
 */
export const PROJECT_ACTIONS = [
  "openInNewTab",
  "copyPreviewUrl",
  "togglePreviewUrl",
  "originalWebsite",
  "downloadZip",
  "regenerateThumbnail",
  "plugins",
  "manageVersions",
  "publish",
  "deleteProject",
] as const;

export type ProjectAction = (typeof PROJECT_ACTIONS)[number];
