import fs from "node:fs";
import path from "node:path";
import { detectProjectType } from "../../devserver/projectType";
import { initializeGitRepository } from "../../generator/gitUtils";
import { getProjectDir, getVersionDir } from "../../generator/versionUtils";
import { gitService } from "../integrations/GitService";
import {
  copyProjectVersionArtifactsInBucket,
  deleteProjectVersionArtifactsFromBucket,
  uploadProjectPreviewToBucket,
  uploadProjectSourceToBucket,
  type ArtifactBuildMeta,
} from "./ProjectArtifactsService";
import { downloadArtifactToDirectory } from "./ProjectArtifactStateService";
import { getProjectThumbnailKey } from "./ProjectStoragePaths";
import { projectMetaService, type ProjectMetaRow, type ProjectVersionRow } from "./ProjectMetaService";

type ProjectSource = "url" | "scratch";

export type DuplicateProjectInput = {
  organizationId: string;
  sourceSlug: string;
  sourceVersion?: number;
  title?: string;
  slug?: string;
};

export type DuplicateProjectResult = {
  success: true;
  sourceSlug: string;
  sourceVersion: number;
  targetSlug: string;
  targetVersion: number;
  title: string;
  artifactsCopied: number;
};

const PROJECT_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RUNTIME_DIR_NAMES = new Set([
  ".astro",
  ".cache",
  ".git",
  ".vite",
  "node_modules",
  "opencode-data",
]);
const SOURCE_PROBE_IGNORED_DIR_NAMES = new Set([
  ...RUNTIME_DIR_NAMES,
  "dist",
]);

function normalizeSlug(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!normalized || !PROJECT_SLUG_PATTERN.test(normalized)) {
    throw new Error("Project slug must use lowercase letters, numbers, and hyphens only.");
  }
  return normalized;
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project-copy";
}

function normalizeTitle(input: string | undefined, fallback: string): string {
  const title = input?.trim() || fallback.trim();
  if (!title) return "Project copy";
  return title;
}

function toProjectSource(value: string | null | undefined): ProjectSource {
  return value === "url" ? "url" : "scratch";
}

function assertCopyableVersion(version: ProjectVersionRow): void {
  if (version.status !== "completed") {
    throw new Error("Only completed project versions can be copied.");
  }
}

function hasLocalSourceFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir)
    .some((entry) => !SOURCE_PROBE_IGNORED_DIR_NAMES.has(entry));
}

function shouldCopyPath(sourceRoot: string, currentPath: string): boolean {
  const rel = path.relative(sourceRoot, currentPath);
  if (!rel) return true;
  return !rel.split(path.sep).some((part) => RUNTIME_DIR_NAMES.has(part));
}

function removeRuntimeDirs(versionDir: string): void {
  for (const dirName of RUNTIME_DIR_NAMES) {
    fs.rmSync(path.join(versionDir, dirName), { recursive: true, force: true });
  }
}

function copyLocalVersionDirectory(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => shouldCopyPath(sourceDir, sourcePath),
  });
  removeRuntimeDirs(targetDir);
}

async function hydrateSourceIntoTarget(options: {
  organizationId: string;
  sourceSlug: string;
  sourceVersion: number;
  sourceDir: string;
  targetDir: string;
}): Promise<void> {
  if (hasLocalSourceFiles(options.sourceDir)) {
    copyLocalVersionDirectory(options.sourceDir, options.targetDir);
    return;
  }

  fs.mkdirSync(options.targetDir, { recursive: true });
  const download = await downloadArtifactToDirectory({
    organizationId: options.organizationId,
    slug: options.sourceSlug,
    version: options.sourceVersion,
    kind: "source",
    destinationDir: options.targetDir,
  });

  removeRuntimeDirs(options.targetDir);

  if (!download.downloaded || !hasLocalSourceFiles(options.targetDir)) {
    throw new Error("Source files for this project version could not be found.");
  }
}

async function findAvailableSlug(organizationId: string, baseSlug: string): Promise<string> {
  const base = normalizeSlug(slugify(baseSlug));
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existingProject = await projectMetaService.getProject(organizationId, candidate);
    if (existingProject) continue;
    if (fs.existsSync(getProjectDir(organizationId, candidate))) continue;
    return candidate;
  }
  throw new Error("Could not find an available project slug.");
}

async function resolveSource(options: {
  organizationId: string;
  slug: string;
  version?: number;
}): Promise<{
  project: ProjectMetaRow;
  version: ProjectVersionRow;
  versionNumber: number;
}> {
  const project = await projectMetaService.getProject(options.organizationId, options.slug);
  if (!project) throw new Error("Source project not found.");

  const versionNumber = options.version ?? project.currentVersion;
  if (!versionNumber || versionNumber < 1) {
    throw new Error("Source project has no current version.");
  }

  const version = await projectMetaService.getProjectVersion(
    options.organizationId,
    options.slug,
    versionNumber,
  );
  if (!version) throw new Error(`Source project version v${versionNumber} not found.`);
  assertCopyableVersion(version);
  return { project, version, versionNumber };
}

async function prepareTargetVersion(options: {
  organizationId: string;
  sourceSlug: string;
  sourceVersion: number;
  targetSlug: string;
  targetVersion: number;
}): Promise<{
  targetDir: string;
  commitHash: string | null;
  previewDir: string | null;
}> {
  const sourceDir = getVersionDir(
    options.organizationId,
    options.sourceSlug,
    options.sourceVersion,
  );
  const targetDir = getVersionDir(
    options.organizationId,
    options.targetSlug,
    options.targetVersion,
  );

  if (fs.existsSync(targetDir)) {
    throw new Error(`Target version directory already exists: ${targetDir}`);
  }

  await hydrateSourceIntoTarget({
    organizationId: options.organizationId,
    sourceSlug: options.sourceSlug,
    sourceVersion: options.sourceVersion,
    sourceDir,
    targetDir,
  });

  await initializeGitRepository(
    targetDir,
    `Copy from ${options.sourceSlug} v${options.sourceVersion}`,
  );

  return {
    targetDir,
    commitHash: await gitService.getCurrentCommit(targetDir),
    previewDir: fs.existsSync(path.join(sourceDir, "dist"))
      ? path.join(sourceDir, "dist")
      : null,
  };
}

async function syncCopiedArtifacts(options: {
  organizationId: string;
  targetSlug: string;
  targetVersion: number;
  targetDir: string;
  commitHash: string | null;
  previewDir: string | null;
}): Promise<void> {
  const projectConfig = detectProjectType(options.targetDir);
  const completedAt = new Date().toISOString();
  const sourceMeta: ArtifactBuildMeta = {
    status: "ready",
    framework: projectConfig.framework,
    commitHash: options.commitHash ?? undefined,
    completedAt,
  };

  await uploadProjectSourceToBucket({
    organizationId: options.organizationId,
    slug: options.targetSlug,
    version: options.targetVersion,
    versionDir: options.targetDir,
    meta: sourceMeta,
  });

  if (options.previewDir && fs.existsSync(path.join(options.previewDir, "index.html"))) {
    await uploadProjectPreviewToBucket({
      organizationId: options.organizationId,
      slug: options.targetSlug,
      version: options.targetVersion,
      localDir: options.previewDir,
      meta: {
        status: "ready",
        framework: projectConfig.framework,
        commitHash: options.commitHash ?? undefined,
        completedAt,
      },
    });
  }
}

class ProjectCopyService {
  async duplicateProject(input: DuplicateProjectInput): Promise<DuplicateProjectResult> {
    const source = await resolveSource({
      organizationId: input.organizationId,
      slug: input.sourceSlug,
      version: input.sourceVersion,
    });
    const sourceTitle =
      source.version.title || source.project.title || source.project.slug;
    const title = normalizeTitle(input.title, `${sourceTitle} copy`);
    const targetSlug = input.slug
      ? normalizeSlug(input.slug)
      : await findAvailableSlug(input.organizationId, title);
    const existingTarget = await projectMetaService.getProject(
      input.organizationId,
      targetSlug,
    );
    if (existingTarget) {
      throw new Error(`Project slug "${targetSlug}" is already in use.`);
    }

    const targetVersion = 1;
    let artifactsCopied = 0;
    const targetDir = getVersionDir(
      input.organizationId,
      targetSlug,
      targetVersion,
    );

    try {
      const copyResult = await copyProjectVersionArtifactsInBucket({
        organizationId: input.organizationId,
        sourceSlug: input.sourceSlug,
        sourceVersion: source.versionNumber,
        targetSlug,
        targetVersion,
      });
      artifactsCopied = copyResult.objectsCopied;

      const prepared = await prepareTargetVersion({
        organizationId: input.organizationId,
        sourceSlug: input.sourceSlug,
        sourceVersion: source.versionNumber,
        targetSlug,
        targetVersion,
      });

      await syncCopiedArtifacts({
        organizationId: input.organizationId,
        targetSlug,
        targetVersion,
        targetDir: prepared.targetDir,
        commitHash: prepared.commitHash,
        previewDir: prepared.previewDir,
      });

      await projectMetaService.createProjectVersion({
        organizationId: input.organizationId,
        slug: targetSlug,
        version: targetVersion,
        source: toProjectSource(source.version.source),
        url: source.version.url ?? source.project.url ?? "",
        title,
        description: source.version.description ?? source.project.description ?? "",
        status: "completed",
        createdAt: new Date(),
      });

      const tags = Array.isArray(source.project.tags) ? source.project.tags : [];
      if (tags.length > 0) {
        await projectMetaService.setTags({
          organizationId: input.organizationId,
          slug: targetSlug,
          tags,
        });
      }

      if (source.version.thumbnailKey && artifactsCopied > 0) {
        await projectMetaService.setVersionThumbnailKey({
          organizationId: input.organizationId,
          slug: targetSlug,
          version: targetVersion,
          thumbnailKey: getProjectThumbnailKey({
            tenantId: input.organizationId,
            slug: targetSlug,
            version: targetVersion,
          }),
        });
      }

      return {
        success: true,
        sourceSlug: input.sourceSlug,
        sourceVersion: source.versionNumber,
        targetSlug,
        targetVersion,
        title,
        artifactsCopied,
      };
    } catch (error) {
      fs.rmSync(path.dirname(targetDir), { recursive: true, force: true });
      await deleteProjectVersionArtifactsFromBucket({
        organizationId: input.organizationId,
        slug: targetSlug,
        version: targetVersion,
      }).catch(() => undefined);
      throw error;
    }
  }

}

export const projectCopyService = new ProjectCopyService();
