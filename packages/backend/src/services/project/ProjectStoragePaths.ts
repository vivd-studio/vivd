export type ProjectArtifactKind = "source" | "preview" | "published" | "thumbnails";

export function getProjectBasePrefix(options: {
  tenantId: string;
  slug: string;
}): string {
  const tenantId = options.tenantId.trim() || "default";
  return `tenants/${tenantId}/projects/${options.slug}`;
}

export function getProjectVersionBasePrefix(options: {
  tenantId: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectBasePrefix(options)}/v${options.version}`;
}

export function getProjectArtifactKeyPrefix(options: {
  tenantId: string;
  slug: string;
  version: number;
  kind: ProjectArtifactKind;
}): string {
  const base = getProjectVersionBasePrefix(options);
  return `${base}/${options.kind}`;
}

export function getProjectPreviewBuildMetaKey(options: {
  tenantId: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectArtifactKeyPrefix({ ...options, kind: "preview" })}/.vivd/build.json`;
}

export function getProjectSourceBuildMetaKey(options: {
  tenantId: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectArtifactKeyPrefix({ ...options, kind: "source" })}/.vivd/build.json`;
}

export function getProjectPublishedBuildMetaKey(options: {
  tenantId: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectArtifactKeyPrefix({ ...options, kind: "published" })}/.vivd/build.json`;
}

export function getProjectThumbnailKey(options: {
  tenantId: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectArtifactKeyPrefix({ ...options, kind: "thumbnails" })}/thumbnail.webp`;
}
