/**
 * Shared project-related utilities.
 */

/**
 * Get a project's last modified timestamp, preferring updatedAt.
 * Falls back to latest version createdAt, then project createdAt.
 */
export function getProjectLastModified(project: {
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
  versions?: Array<{ createdAt?: string | Date | null }>;
}): number {
  // Prefer updatedAt if available (set when files are modified)
  if (project.updatedAt) {
    return new Date(project.updatedAt).getTime();
  }
  // Fallback to latest version's createdAt
  if (project.versions && project.versions.length > 0) {
    const latestVersion = project.versions.reduce((latest, version) => {
      const versionDate = new Date(version.createdAt || 0).getTime();
      const latestDate = new Date(latest.createdAt || 0).getTime();
      return versionDate > latestDate ? version : latest;
    });
    return new Date(latestVersion.createdAt || 0).getTime();
  }
  // Final fallback to project createdAt
  return new Date(project.createdAt || 0).getTime();
}
