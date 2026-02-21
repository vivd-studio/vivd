import * as path from "path";
import * as fs from "fs";
import { projectMetaService } from "../services/project/ProjectMetaService";

function detectProjectsDir(): string {
  const env = process.env.PROJECTS_DIR?.trim();
  if (env) return env;

  // In Docker prod/dev, projects are mounted at `/app/projects`.
  // Locally, we expect the backend to be started from `packages/backend/` so `./projects` works.
  if (fs.existsSync("/app/projects")) return "/app/projects";
  return path.resolve(process.cwd(), "projects");
}

// Base directory for all projects
const PROJECTS_DIR = detectProjectsDir();
const TENANTS_DIRNAME = "tenants";
const DEFAULT_TENANT_ID = "default";

export function getProjectsDir(): string {
  return PROJECTS_DIR;
}

export function getProjectsRootDir(): string {
  return PROJECTS_DIR;
}

export function getTenantsDir(): string {
  return path.join(PROJECTS_DIR, TENANTS_DIRNAME);
}

export function getActiveTenantId(): string {
  const tenantId =
    process.env.PROJECTS_TENANT_ID?.trim() ||
    process.env.TENANT_ID?.trim() ||
    process.env.VIVD_TENANT_ID?.trim();
  return tenantId || DEFAULT_TENANT_ID;
}

export function getTenantProjectsDir(tenantId: string): string {
  return path.join(getTenantsDir(), tenantId.trim() || DEFAULT_TENANT_ID);
}

export async function listProjectSlugs(organizationId: string): Promise<string[]> {
  const projects = await projectMetaService.listProjects(organizationId);
  return projects.map((p) => p.slug).sort((a, b) => a.localeCompare(b));
}

// Project-level metadata (DB-backed; replaces projects/<slug>/manifest.json)
export interface ProjectManifest {
  url: string;
  source?: "url" | "scratch";
  title?: string;
  description?: string;
  createdAt: string;
  updatedAt?: string; // Last time any file in the project was modified
  currentVersion: number;
  publicPreviewEnabled: boolean;
  versions: VersionInfo[];
}

export interface VersionInfo {
  version: number;
  createdAt: string;
  status: string; // 'processing' | 'completed' | 'failed' | etc.
  startedAt?: string; // ISO timestamp when processing started
  errorMessage?: string; // Error message when status is 'failed'
}

// Version-specific metadata (DB-backed; replaces projects/<slug>/v<N>/.vivd/project.json)
export interface VersionData {
  url: string;
  source?: "url" | "scratch";
  title?: string;
  description?: string;
  createdAt: string;
  status: string;
  version: number;
  startedAt?: string; // ISO timestamp when processing started
  errorMessage?: string; // Error message when status is 'failed'
  thumbnailKey?: string;
}

// Statuses that indicate a project is currently being processed
export const PROCESSING_STATUSES = [
  "processing",
  "scraping",
  "analyzing_content",
  "analyzing_images",
  "capturing_references",
  "creating_hero",
  "generating_html",
  "pending",
];

// How long (in minutes) before a processing project is considered stale
const STALE_THRESHOLD_MINUTES = 30;

/**
 * Check if a version is stale (stuck in processing for too long)
 */
export function isVersionStale(
  versionInfo: VersionInfo | VersionData | null,
): boolean {
  if (!versionInfo) return false;

  // Only check for processing statuses
  if (!PROCESSING_STATUSES.includes(versionInfo.status)) {
    return false;
  }

  // Use startedAt if available, otherwise fall back to createdAt
  const startTime = versionInfo.startedAt || versionInfo.createdAt;
  if (!startTime) return false;

  const startDate = new Date(startTime);
  const now = new Date();
  const diffMinutes = (now.getTime() - startDate.getTime()) / (1000 * 60);

  return diffMinutes > STALE_THRESHOLD_MINUTES;
}

/**
 * Get the base project directory for a slug
 */
export function getProjectDir(organizationId: string, slug: string): string {
  const tenantDir = getTenantProjectsDir(organizationId);
  const tenantPath = path.join(tenantDir, slug);
  if (fs.existsSync(tenantPath)) return tenantPath;

  // Legacy single-tenant layout: projects/<slug>/... (only for default tenant).
  const legacyPath = path.join(PROJECTS_DIR, slug);
  if (organizationId === DEFAULT_TENANT_ID && fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  // Default to tenant layout for new projects.
  return tenantPath;
}

/**
 * Get the version-specific directory
 */
export function getVersionDir(
  organizationId: string,
  slug: string,
  version: number,
): string {
  return path.join(getProjectDir(organizationId, slug), `v${version}`);
}

export async function getManifest(
  organizationId: string,
  slug: string,
): Promise<ProjectManifest | null> {
  const project = await projectMetaService.getProject(organizationId, slug);
  if (!project) return null;

  const versions = await projectMetaService.listProjectVersions(organizationId, slug);
  return {
    url: project.url,
    source: (project.source as "url" | "scratch") ?? undefined,
    title: project.title || undefined,
    description: project.description || undefined,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt?.toISOString(),
    currentVersion: project.currentVersion,
    publicPreviewEnabled: project.publicPreviewEnabled,
    versions: versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt.toISOString(),
      status: v.status,
      startedAt: v.startedAt?.toISOString(),
      errorMessage: v.errorMessage ?? undefined,
    })),
  };
}

export async function touchProjectUpdatedAt(
  organizationId: string,
  slug: string,
): Promise<void> {
  await projectMetaService.touchUpdatedAt(organizationId, slug);
}

/**
 * Get the current (latest) version number for a project
 * Returns 0 if no versions exist
 */
export async function getCurrentVersion(
  organizationId: string,
  slug: string,
): Promise<number> {
  return projectMetaService.getCurrentVersion(organizationId, slug);
}

/**
 * Get the highest version number for a project
 * Returns 0 if no versions exist
 */
export async function getHighestVersion(
  organizationId: string,
  slug: string,
): Promise<number> {
  const versions = await projectMetaService.listProjectVersions(organizationId, slug);
  if (versions.length === 0) return 0;
  return Math.max(...versions.map((v) => v.version));
}

/**
 * Get the next version number for a project
 * Based on the highest existing version, not the currently selected version
 */
export async function getNextVersion(
  organizationId: string,
  slug: string,
): Promise<number> {
  return projectMetaService.getNextVersion(organizationId, slug);
}

/**
 * Check if a specific version exists
 */
export function versionExists(
  organizationId: string,
  slug: string,
  version: number,
): boolean {
  return fs.existsSync(getVersionDir(organizationId, slug, version));
}

/**
 * List all versions for a project
 */
export async function listVersions(
  organizationId: string,
  slug: string,
): Promise<VersionInfo[]> {
  const versions = await projectMetaService.listProjectVersions(organizationId, slug);
  return versions.map((v) => ({
    version: v.version,
    createdAt: v.createdAt.toISOString(),
    status: v.status,
    startedAt: v.startedAt?.toISOString(),
    errorMessage: v.errorMessage ?? undefined,
  }));
}

/**
 * Check if a project is a legacy project (no versioning)
 */
export function isLegacyProject(slug: string): boolean {
  void slug;
  return false;
}

/**
 * Migrate a legacy project to the versioned structure
 * Moves all files from projects/<slug>/ to projects/<slug>/v1/
 */
export function migrateProjectIfNeeded(slug: string): boolean {
  void slug;
  return false;
}

/**
 * Create or update manifest for a new version
 */
export function createVersionEntry(
  organizationId: string,
  slug: string,
  version: number,
  url: string,
  status: string = "processing",
): Promise<void> {
  const now = new Date();
  const source: "url" | "scratch" = url ? "url" : "scratch";
  return projectMetaService.createProjectVersion({
    organizationId,
    slug,
    version,
    source,
    url,
    title: "",
    description: "",
    status,
    createdAt: now,
  });
}

/**
 * Update the status of a specific version
 * @param slug - Project slug
 * @param version - Version number
 * @param status - New status
 * @param errorMessage - Optional error message when status is 'failed'
 */
export async function updateVersionStatus(
  organizationId: string,
  slug: string,
  version: number,
  status: string,
  errorMessage?: string,
): Promise<void> {
  await projectMetaService.updateVersionStatus({ organizationId, slug, version, status, errorMessage });
}

/**
 * Get version data from a specific version's project.json
 */
export async function getVersionData(
  organizationId: string,
  slug: string,
  version: number,
): Promise<VersionData | null> {
  const record = await projectMetaService.getProjectVersion(organizationId, slug, version);
  if (!record) return null;
  return {
    url: record.url,
    source: (record.source as "url" | "scratch") ?? undefined,
    title: record.title || undefined,
    description: record.description || undefined,
    createdAt: record.createdAt.toISOString(),
    status: record.status,
    version: record.version,
    startedAt: record.startedAt?.toISOString(),
    errorMessage: record.errorMessage ?? undefined,
    thumbnailKey: record.thumbnailKey ?? undefined,
  };
}

/**
 * Delete a specific version
 */
export async function deleteVersion(
  organizationId: string,
  slug: string,
  version: number,
): Promise<void> {
  const versionDir = getVersionDir(organizationId, slug, version);

  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }

  await projectMetaService.deleteProjectVersion({ organizationId, slug, version });
}
