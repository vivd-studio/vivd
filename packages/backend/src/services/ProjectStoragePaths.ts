import { getActiveTenantId } from "../generator/versionUtils";

export type ProjectArtifactKind = "source" | "preview" | "published" | "thumbnails";

export function getProjectVersionBasePrefix(options: {
  tenantId?: string;
  slug: string;
  version: number;
}): string {
  const tenantId = (options.tenantId || getActiveTenantId()).trim() || "default";
  return `tenants/${tenantId}/projects/${options.slug}/v${options.version}`;
}

export function getProjectArtifactKeyPrefix(options: {
  tenantId?: string;
  slug: string;
  version: number;
  kind: ProjectArtifactKind;
}): string {
  const base = getProjectVersionBasePrefix(options);
  return `${base}/${options.kind}`;
}

export function getProjectPreviewBuildMetaKey(options: {
  tenantId?: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectArtifactKeyPrefix({ ...options, kind: "preview" })}/.vivd/build.json`;
}

export function getProjectPublishedBuildMetaKey(options: {
  tenantId?: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectArtifactKeyPrefix({ ...options, kind: "published" })}/.vivd/build.json`;
}

export function getProjectThumbnailKey(options: {
  tenantId?: string;
  slug: string;
  version: number;
}): string {
  return `${getProjectArtifactKeyPrefix({ ...options, kind: "thumbnails" })}/thumbnail.webp`;
}
