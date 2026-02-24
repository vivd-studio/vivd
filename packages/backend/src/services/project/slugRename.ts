import { getProjectBasePrefix } from "./ProjectStoragePaths";

export function rewriteProjectArtifactKeyForSlug(options: {
  organizationId: string;
  oldSlug: string;
  newSlug: string;
  key: string | null;
}): string | null {
  if (!options.key) return options.key;

  const oldPrefix = getProjectBasePrefix({
    tenantId: options.organizationId,
    slug: options.oldSlug,
  });
  const newPrefix = getProjectBasePrefix({
    tenantId: options.organizationId,
    slug: options.newSlug,
  });

  if (options.key === oldPrefix) {
    return newPrefix;
  }
  if (!options.key.startsWith(`${oldPrefix}/`)) {
    return options.key;
  }

  return `${newPrefix}${options.key.slice(oldPrefix.length)}`;
}

export function alignProjectArtifactKeyToSlug(options: {
  organizationId: string;
  slug: string;
  key: string | null;
}): string | null {
  if (!options.key) return options.key;

  const parts = options.key.split("/");
  if (parts.length < 4) return options.key;
  if (
    parts[0] !== "tenants" ||
    parts[1] !== options.organizationId ||
    parts[2] !== "projects"
  ) {
    return options.key;
  }
  if (parts[3] === options.slug) {
    return options.key;
  }

  parts[3] = options.slug;
  return parts.join("/");
}
