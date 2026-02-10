import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  projectMeta,
  projectPublishChecklist,
  projectVersion,
} from "../db/schema";
import {
  getActiveTenantId,
  getProjectsRootDir,
  getTenantProjectsDir,
} from "../generator/versionUtils";
import { getVivdInternalFilesPath } from "../generator/vivdPaths";
import type { PrePublishChecklist } from "../opencode/checklistTypes";
import { uploadProjectThumbnailToBucket } from "./ProjectArtifactsService";

type ManifestFile = {
  url?: unknown;
  source?: unknown;
  title?: unknown;
  description?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  currentVersion?: unknown;
  versions?: unknown;
};

type ManifestVersionFile = {
  version?: unknown;
  createdAt?: unknown;
  status?: unknown;
  startedAt?: unknown;
  errorMessage?: unknown;
};

type VersionProjectFile = {
  url?: unknown;
  source?: unknown;
  title?: unknown;
  description?: unknown;
  createdAt?: unknown;
  status?: unknown;
  startedAt?: unknown;
  errorMessage?: unknown;
};

export type ProjectMetaMigrationProjectResult = {
  slug: string;
  versionsUpserted: number;
  checklistsUpserted: number;
  thumbnailsUploaded: number;
};

export type ProjectMetaMigrationResult = {
  success: true;
  tenantId: string;
  projectsScanned: number;
  projectsMigrated: number;
  versionsUpserted: number;
  checklistsUpserted: number;
  thumbnailsUploaded: number;
  projects?: ProjectMetaMigrationProjectResult[];
  errors: Array<{ slug: string; error: string }>;
};

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return Number.isFinite(Date.parse(value));
}

function toIsoDateOrNull(value: unknown): string | null {
  if (!isValidIsoDate(value)) return null;
  return value;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function looksLikeProjectDir(dir: string): boolean {
  try {
    const items = fs.readdirSync(dir);
    if (items.includes("manifest.json")) return true;
    if (items.some((name) => /^v\d+$/.test(name))) return true;
    return false;
  } catch {
    return false;
  }
}

function listProjectDirsFromFilesystem(options: {
  tenantId: string;
}): Array<{
  slug: string;
  projectDir: string;
}> {
  const projectsRoot = getProjectsRootDir();
  const tenantProjectsRoot = getTenantProjectsDir(options.tenantId);
  const bySlug = new Map<string, string>();

  if (fs.existsSync(projectsRoot)) {
    for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "tenants") continue;

      const projectDir = path.join(projectsRoot, entry.name);
      if (!looksLikeProjectDir(projectDir)) continue;
      bySlug.set(entry.name, projectDir);
    }
  }

  // Tenant layout has priority over legacy root for the same slug.
  if (fs.existsSync(tenantProjectsRoot)) {
    for (const entry of fs.readdirSync(tenantProjectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(tenantProjectsRoot, entry.name);
      if (!looksLikeProjectDir(projectDir)) continue;
      bySlug.set(entry.name, projectDir);
    }
  }

  return Array.from(bySlug.entries())
    .map(([slug, projectDir]) => ({ slug, projectDir }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function listVersionNumbers(projectDir: string): number[] {
  if (!fs.existsSync(projectDir)) return [];
  const versionNumbers: number[] = [];
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^v(\d+)$/);
    if (!match) continue;
    const n = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(n) && n > 0) versionNumbers.push(n);
  }
  versionNumbers.sort((a, b) => a - b);
  return versionNumbers;
}

async function migrateOneProject(options: {
  organizationId: string;
  slug: string;
  projectDir: string;
}): Promise<ProjectMetaMigrationProjectResult> {
  const { organizationId, slug, projectDir } = options;

  const manifestPath = path.join(projectDir, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? readJsonFile<ManifestFile>(manifestPath)
    : null;

  const versionNumbersFromFs = listVersionNumbers(projectDir);

  const manifestVersionsRaw = Array.isArray(manifest?.versions)
    ? (manifest!.versions as ManifestVersionFile[])
    : [];
  const versionNumbersFromManifest = manifestVersionsRaw
    .map((v) => (typeof v.version === "number" ? v.version : Number(v.version)))
    .filter((n) => Number.isFinite(n) && n > 0) as number[];

  const versionNumbers = Array.from(
    new Set([...versionNumbersFromFs, ...versionNumbersFromManifest]),
  ).sort((a, b) => a - b);

  const createdAtIso =
    toIsoDateOrNull(manifest?.createdAt) ??
    (() => {
      for (const v of manifestVersionsRaw) {
        const iso = toIsoDateOrNull(v.createdAt);
        if (iso) return iso;
      }
      return null;
    })() ??
    new Date().toISOString();

  const updatedAtIso =
    toIsoDateOrNull(manifest?.updatedAt) ?? new Date().toISOString();

  const url = typeof manifest?.url === "string" ? manifest.url : "";
  const sourceRaw = typeof manifest?.source === "string" ? manifest.source : "";
  const source: "url" | "scratch" =
    sourceRaw === "scratch" ? "scratch" : url ? "url" : "scratch";
  const title = typeof manifest?.title === "string" ? manifest.title : "";
  const description =
    typeof manifest?.description === "string" ? manifest.description : "";

  const currentVersionRaw =
    typeof manifest?.currentVersion === "number"
      ? manifest.currentVersion
      : Number(manifest?.currentVersion);
  const currentVersion =
    Number.isFinite(currentVersionRaw) && currentVersionRaw > 0
      ? currentVersionRaw
      : versionNumbers.length > 0
        ? Math.max(...versionNumbers)
        : 0;

  await db
    .insert(projectMeta)
    .values({
      organizationId,
      slug,
      source,
      url,
      title,
      description,
      currentVersion,
      createdAt: new Date(createdAtIso),
      updatedAt: new Date(updatedAtIso),
    })
    .onConflictDoUpdate({
      target: [projectMeta.organizationId, projectMeta.slug],
      set: {
        source,
        url,
        title,
        description,
        currentVersion,
        updatedAt: new Date(updatedAtIso),
      },
    });

  let versionsUpserted = 0;
  let checklistsUpserted = 0;
  let thumbnailsUploaded = 0;

  for (const version of versionNumbers) {
    const versionDir = path.join(projectDir, `v${version}`);

    const manifestVersion = manifestVersionsRaw.find(
      (v) => Number(v.version) === version,
    );

    const projectJsonPath = getVivdInternalFilesPath(versionDir, "project.json");
    const versionProject = fs.existsSync(projectJsonPath)
      ? readJsonFile<VersionProjectFile>(projectJsonPath)
      : null;

    const versionUrl =
      typeof versionProject?.url === "string"
        ? versionProject.url
        : typeof url === "string"
          ? url
          : "";
    const versionSourceRaw =
      typeof versionProject?.source === "string"
        ? versionProject.source
        : sourceRaw;
    const versionSource: "url" | "scratch" =
      versionSourceRaw === "scratch" ? "scratch" : versionUrl ? "url" : "scratch";

    const versionTitle =
      typeof versionProject?.title === "string" ? versionProject.title : title;
    const versionDescription =
      typeof versionProject?.description === "string"
        ? versionProject.description
        : description;

    const versionCreatedAtIso =
      toIsoDateOrNull(versionProject?.createdAt) ??
      toIsoDateOrNull(manifestVersion?.createdAt) ??
      createdAtIso;

    const versionStatus =
      typeof versionProject?.status === "string"
        ? versionProject.status
        : typeof manifestVersion?.status === "string"
          ? manifestVersion.status
          : "completed";

    const startedAtIso =
      toIsoDateOrNull(versionProject?.startedAt) ??
      toIsoDateOrNull(manifestVersion?.startedAt) ??
      versionCreatedAtIso;

    const errorMessage =
      typeof versionProject?.errorMessage === "string"
        ? versionProject.errorMessage
        : typeof manifestVersion?.errorMessage === "string"
          ? manifestVersion.errorMessage
          : null;

    await db
      .insert(projectVersion)
      .values({
        id: randomUUID(),
        organizationId,
        projectSlug: slug,
        version,
        source: versionSource,
        url: versionUrl,
        title: versionTitle,
        description: versionDescription,
        status: versionStatus,
        startedAt: startedAtIso ? new Date(startedAtIso) : null,
        errorMessage,
        createdAt: new Date(versionCreatedAtIso),
        updatedAt: new Date(updatedAtIso),
      })
      .onConflictDoUpdate({
        target: [
          projectVersion.organizationId,
          projectVersion.projectSlug,
          projectVersion.version,
        ],
        set: {
          source: versionSource,
          url: versionUrl,
          title: versionTitle,
          description: versionDescription,
          status: versionStatus,
          startedAt: startedAtIso ? new Date(startedAtIso) : null,
          errorMessage,
          updatedAt: new Date(updatedAtIso),
        },
      });

    versionsUpserted++;

    // Migrate publish checklist (if present).
    const checklistPath = getVivdInternalFilesPath(versionDir, "publish-checklist.json");
    if (fs.existsSync(checklistPath)) {
      const checklist = readJsonFile<PrePublishChecklist>(checklistPath);
      if (checklist) {
        const runAtIso = isValidIsoDate(checklist.runAt)
          ? checklist.runAt
          : versionCreatedAtIso;

        await db
          .insert(projectPublishChecklist)
          .values({
            id: randomUUID(),
            organizationId,
            projectSlug: slug,
            version,
            runAt: new Date(runAtIso),
            snapshotCommitHash:
              typeof checklist.snapshotCommitHash === "string"
                ? checklist.snapshotCommitHash
                : null,
            checklist,
            createdAt: new Date(runAtIso),
            updatedAt: new Date(updatedAtIso),
          })
          .onConflictDoUpdate({
            target: [
              projectPublishChecklist.organizationId,
              projectPublishChecklist.projectSlug,
              projectPublishChecklist.version,
            ],
            set: {
              runAt: new Date(runAtIso),
              snapshotCommitHash:
                typeof checklist.snapshotCommitHash === "string"
                  ? checklist.snapshotCommitHash
                  : null,
              checklist,
              updatedAt: new Date(updatedAtIso),
            },
          });

        checklistsUpserted++;
      }
    }

    // Upload thumbnail (if present) and persist key.
    const thumbnailPath = getVivdInternalFilesPath(versionDir, "thumbnail.webp");
    if (fs.existsSync(thumbnailPath)) {
      try {
        const uploaded = await uploadProjectThumbnailToBucket({
          organizationId,
          localFilePath: thumbnailPath,
          slug,
          version,
        });

        if (uploaded.uploaded && uploaded.key) {
          await db
            .update(projectVersion)
            .set({ thumbnailKey: uploaded.key, updatedAt: new Date(updatedAtIso) })
            .where(
              and(
                eq(projectVersion.organizationId, organizationId),
                eq(projectVersion.projectSlug, slug),
                eq(projectVersion.version, version),
              ),
            );
          thumbnailsUploaded++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[migrate-project-metadata-to-db] Thumbnail upload failed for ${slug}/v${version}: ${message}`,
        );
      }
    }
  }

  return { slug, versionsUpserted, checklistsUpserted, thumbnailsUploaded };
}

export async function migrateProjectMetadataToDbFromFilesystem(options?: {
  tenantId?: string;
  includeProjectResults?: boolean;
}): Promise<ProjectMetaMigrationResult> {
  const tenantId = options?.tenantId ?? getActiveTenantId();
  const includeProjectResults = options?.includeProjectResults ?? false;

  const projects = listProjectDirsFromFilesystem({ tenantId });
  if (projects.length === 0) {
    return {
      success: true,
      tenantId,
      projectsScanned: 0,
      projectsMigrated: 0,
      versionsUpserted: 0,
      checklistsUpserted: 0,
      thumbnailsUploaded: 0,
      projects: includeProjectResults ? [] : undefined,
      errors: [],
    };
  }

  let projectsScanned = 0;
  let projectsMigrated = 0;
  let versionsUpserted = 0;
  let checklistsUpserted = 0;
  let thumbnailsUploaded = 0;
  const errors: Array<{ slug: string; error: string }> = [];
  const projectResults: ProjectMetaMigrationProjectResult[] = [];

  for (const project of projects) {
    projectsScanned++;
    try {
      const res = await migrateOneProject({ ...project, organizationId: tenantId });
      projectsMigrated++;
      versionsUpserted += res.versionsUpserted;
      checklistsUpserted += res.checklistsUpserted;
      thumbnailsUploaded += res.thumbnailsUploaded;
      if (includeProjectResults) projectResults.push(res);
    } catch (err) {
      errors.push({
        slug: project.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    success: true,
    tenantId,
    projectsScanned,
    projectsMigrated,
    versionsUpserted,
    checklistsUpserted,
    thumbnailsUploaded,
    projects: includeProjectResults ? projectResults : undefined,
    errors,
  };
}
