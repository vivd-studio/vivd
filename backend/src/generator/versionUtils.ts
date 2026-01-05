import * as path from "path";
import * as fs from "fs";
import {
  migrateVivdInternalArtifactsInVersion,
  getVivdInternalFilesPath,
} from "./vivdPaths";

function detectProjectsDir(): string {
  const env = process.env.PROJECTS_DIR?.trim();
  if (env) return env;

  // In Docker prod/dev, projects are mounted at `/app/projects`.
  // Locally, we expect the backend to be started from `backend/` so `./projects` works.
  if (fs.existsSync("/app/projects")) return "/app/projects";
  return path.resolve(process.cwd(), "projects");
}

// Base directory for all projects
const PROJECTS_DIR = detectProjectsDir();

export function getProjectsDir(): string {
  return PROJECTS_DIR;
}

// Project-level manifest (at projects/<slug>/manifest.json)
export interface ProjectManifest {
  url: string;
  source?: "url" | "scratch";
  title?: string;
  description?: string;
  createdAt: string;
  currentVersion: number;
  versions: VersionInfo[];
}

export interface VersionInfo {
  version: number;
  createdAt: string;
  status: string; // 'processing' | 'completed' | 'failed' | etc.
  startedAt?: string; // ISO timestamp when processing started
}

// Version-specific data (at projects/<slug>/v<N>/.vivd/project.json)
export interface VersionData {
  url: string;
  source?: "url" | "scratch";
  title?: string;
  description?: string;
  createdAt: string;
  status: string;
  version: number;
  startedAt?: string; // ISO timestamp when processing started
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
  versionInfo: VersionInfo | VersionData | null
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
export function getProjectDir(slug: string): string {
  return path.join(PROJECTS_DIR, slug);
}

/**
 * Get the version-specific directory
 */
export function getVersionDir(slug: string, version: number): string {
  return path.join(getProjectDir(slug), `v${version}`);
}

/**
 * Get the manifest path for a project
 */
function getManifestPath(slug: string): string {
  return path.join(getProjectDir(slug), "manifest.json");
}

/**
 * Read the project manifest
 */
export function getManifest(slug: string): ProjectManifest | null {
  const manifestPath = getManifestPath(slug);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    console.error(`Error reading manifest for ${slug}:`, e);
    return null;
  }
}

/**
 * Save the project manifest
 */
export function saveManifest(slug: string, manifest: ProjectManifest): void {
  const manifestPath = getManifestPath(slug);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Get the current (latest) version number for a project
 * Returns 0 if no versions exist
 */
export function getCurrentVersion(slug: string): number {
  const manifest = getManifest(slug);
  if (manifest) {
    return manifest.currentVersion;
  }
  // Check for legacy project (files directly in slug folder)
  const projectDir = getProjectDir(slug);
  if (
    fs.existsSync(path.join(projectDir, "index.html")) ||
    fs.existsSync(path.join(projectDir, "project.json"))
  ) {
    // Legacy project exists, will be migrated to v1
    return 1;
  }
  return 0;
}

/**
 * Get the highest version number for a project
 * Returns 0 if no versions exist
 */
export function getHighestVersion(slug: string): number {
  const manifest = getManifest(slug);
  if (manifest && manifest.versions.length > 0) {
    // Return the maximum version number from the versions array
    return Math.max(...manifest.versions.map((v) => v.version));
  }
  // Check for legacy project (files directly in slug folder)
  const projectDir = getProjectDir(slug);
  if (
    fs.existsSync(path.join(projectDir, "index.html")) ||
    fs.existsSync(path.join(projectDir, "project.json"))
  ) {
    // Legacy project exists, will be migrated to v1
    return 1;
  }
  return 0;
}

/**
 * Get the next version number for a project
 * Based on the highest existing version, not the currently selected version
 */
export function getNextVersion(slug: string): number {
  return getHighestVersion(slug) + 1;
}

/**
 * Check if a specific version exists
 */
export function versionExists(slug: string, version: number): boolean {
  return fs.existsSync(getVersionDir(slug, version));
}

/**
 * List all versions for a project
 */
export function listVersions(slug: string): VersionInfo[] {
  const manifest = getManifest(slug);
  if (manifest) {
    return manifest.versions;
  }
  return [];
}

/**
 * Check if a project is a legacy project (no versioning)
 */
export function isLegacyProject(slug: string): boolean {
  const projectDir = getProjectDir(slug);
  const manifestPath = getManifestPath(slug);

  // If manifest exists, it's not legacy
  if (fs.existsSync(manifestPath)) {
    return false;
  }

  // Check if there are files directly in the project folder (legacy structure)
  const hasDirectFiles =
    fs.existsSync(path.join(projectDir, "index.html")) ||
    fs.existsSync(path.join(projectDir, "project.json"));

  return hasDirectFiles;
}

/**
 * Migrate a legacy project to the versioned structure
 * Moves all files from projects/<slug>/ to projects/<slug>/v1/
 */
export function migrateProjectIfNeeded(slug: string): boolean {
  if (!isLegacyProject(slug)) {
    return false;
  }

  console.log(`[Version] Migrating legacy project: ${slug}`);

  const projectDir = getProjectDir(slug);
  const v1Dir = getVersionDir(slug, 1);

  // Create v1 directory
  fs.mkdirSync(v1Dir, { recursive: true });

  // Get all files and directories in the project folder
  const items = fs.readdirSync(projectDir, { withFileTypes: true });

  // Read existing project.json if it exists for metadata
  let legacyProjectData: any = {};
  const legacyProjectJsonPath = path.join(projectDir, "project.json");
  if (fs.existsSync(legacyProjectJsonPath)) {
    try {
      legacyProjectData = JSON.parse(
        fs.readFileSync(legacyProjectJsonPath, "utf-8")
      );
    } catch (e) {
      console.error(`Error reading legacy project.json for ${slug}:`, e);
    }
  }

  // Move all items to v1 (except v1 itself and manifest.json if somehow exists)
  for (const item of items) {
    if (item.name === "v1" || item.name === "manifest.json") {
      continue;
    }

    const sourcePath = path.join(projectDir, item.name);
    const destPath = path.join(v1Dir, item.name);

    fs.renameSync(sourcePath, destPath);
  }

  // Move vivd process files into `.vivd/` inside v1
  try {
    migrateVivdInternalArtifactsInVersion(v1Dir);
  } catch (e) {
    console.error(`[Version] Failed to migrate vivd files for ${slug}/v1:`, e);
  }

  // Update the project.json in v1 to include version number
  const v1ProjectJsonPath = getVivdInternalFilesPath(v1Dir, "project.json");
  if (fs.existsSync(v1ProjectJsonPath)) {
    try {
      const projectData = JSON.parse(
        fs.readFileSync(v1ProjectJsonPath, "utf-8")
      );
      projectData.version = 1;
      fs.writeFileSync(v1ProjectJsonPath, JSON.stringify(projectData, null, 2));
    } catch (e) {
      console.error(`Error updating v1 project.json for ${slug}:`, e);
    }
  }

  // Create manifest
  const manifest: ProjectManifest = {
    url: legacyProjectData.url || "",
    createdAt: legacyProjectData.createdAt || new Date().toISOString(),
    currentVersion: 1,
    versions: [
      {
        version: 1,
        createdAt: legacyProjectData.createdAt || new Date().toISOString(),
        status: legacyProjectData.status || "completed",
      },
    ],
  };

  saveManifest(slug, manifest);

  console.log(`[Version] Successfully migrated ${slug} to versioned structure`);
  return true;
}

/**
 * Create or update manifest for a new version
 */
export function createVersionEntry(
  slug: string,
  version: number,
  url: string,
  status: string = "processing"
): void {
  const projectDir = getProjectDir(slug);

  // Ensure project directory exists
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  let manifest = getManifest(slug);
  const now = new Date().toISOString();

  if (!manifest) {
    // Create new manifest
    manifest = {
      url,
      createdAt: now,
      currentVersion: version,
      versions: [],
    };
  }

  // Check if version already exists in versions array
  const existingIdx = manifest.versions.findIndex((v) => v.version === version);

  if (existingIdx >= 0) {
    // Update existing version entry
    manifest.versions[existingIdx] = {
      version,
      createdAt: now,
      status,
      startedAt: now, // Track when processing started
    };
  } else {
    // Add new version
    manifest.versions.push({
      version,
      createdAt: now,
      status,
      startedAt: now, // Track when processing started
    });
  }

  // Update current version if this is the latest
  if (version >= manifest.currentVersion) {
    manifest.currentVersion = version;
  }

  // Sort versions by version number
  manifest.versions.sort((a, b) => a.version - b.version);

  saveManifest(slug, manifest);
}

/**
 * Update the status of a specific version
 */
export function updateVersionStatus(
  slug: string,
  version: number,
  status: string
): void {
  const manifest = getManifest(slug);
  if (!manifest) {
    console.error(
      `Cannot update version status: manifest not found for ${slug}`
    );
    return;
  }

  const versionEntry = manifest.versions.find((v) => v.version === version);
  if (versionEntry) {
    versionEntry.status = status;
    saveManifest(slug, manifest);
  }
}

/**
 * Get version data from a specific version's project.json
 */
export function getVersionData(
  slug: string,
  version: number
): VersionData | null {
  const versionDir = getVersionDir(slug, version);
  const projectJsonPath = getVivdInternalFilesPath(versionDir, "project.json");

  if (!fs.existsSync(projectJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
  } catch (e) {
    console.error(`Error reading version data for ${slug}/v${version}:`, e);
    return null;
  }
}

/**
 * Delete a specific version
 */
export function deleteVersion(slug: string, version: number): void {
  const versionDir = getVersionDir(slug, version);

  if (fs.existsSync(versionDir)) {
    fs.rmSync(versionDir, { recursive: true, force: true });
  }

  // Update manifest
  const manifest = getManifest(slug);
  if (manifest) {
    manifest.versions = manifest.versions.filter((v) => v.version !== version);

    // Update current version if needed
    if (manifest.currentVersion === version) {
      const remaining = manifest.versions.map((v) => v.version);
      manifest.currentVersion =
        remaining.length > 0 ? Math.max(...remaining) : 0;
    }

    saveManifest(slug, manifest);
  }
}
