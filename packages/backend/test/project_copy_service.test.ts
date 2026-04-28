import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  state,
  getProjectMock,
  getProjectVersionMock,
  getNextVersionMock,
  createProjectVersionMock,
  setTagsMock,
  setVersionThumbnailKeyMock,
  copyProjectVersionArtifactsInBucketMock,
  deleteProjectVersionArtifactsFromBucketMock,
  uploadProjectSourceToBucketMock,
  uploadProjectPreviewToBucketMock,
  downloadArtifactToDirectoryMock,
  initializeGitRepositoryMock,
  getCurrentCommitMock,
  detectProjectTypeMock,
} = vi.hoisted(() => ({
  state: { projectsRoot: "" },
  getProjectMock: vi.fn(),
  getProjectVersionMock: vi.fn(),
  getNextVersionMock: vi.fn(),
  createProjectVersionMock: vi.fn(),
  setTagsMock: vi.fn(),
  setVersionThumbnailKeyMock: vi.fn(),
  copyProjectVersionArtifactsInBucketMock: vi.fn(),
  deleteProjectVersionArtifactsFromBucketMock: vi.fn(),
  uploadProjectSourceToBucketMock: vi.fn(),
  uploadProjectPreviewToBucketMock: vi.fn(),
  downloadArtifactToDirectoryMock: vi.fn(),
  initializeGitRepositoryMock: vi.fn(),
  getCurrentCommitMock: vi.fn(),
  detectProjectTypeMock: vi.fn(),
}));

vi.mock("../src/generator/versionUtils", () => ({
  getProjectDir: (organizationId: string, slug: string) =>
    `${state.projectsRoot}/${organizationId}/${slug}`,
  getVersionDir: (organizationId: string, slug: string, version: number) =>
    `${state.projectsRoot}/${organizationId}/${slug}/v${version}`,
}));

vi.mock("../src/generator/gitUtils", () => ({
  initializeGitRepository: initializeGitRepositoryMock,
}));

vi.mock("../src/devserver/projectType", () => ({
  detectProjectType: detectProjectTypeMock,
}));

vi.mock("../src/services/integrations/GitService", () => ({
  gitService: {
    getCurrentCommit: getCurrentCommitMock,
  },
}));

vi.mock("../src/services/project/ProjectMetaService", () => ({
  projectMetaService: {
    getProject: getProjectMock,
    getProjectVersion: getProjectVersionMock,
    getNextVersion: getNextVersionMock,
    createProjectVersion: createProjectVersionMock,
    setTags: setTagsMock,
    setVersionThumbnailKey: setVersionThumbnailKeyMock,
  },
}));

vi.mock("../src/services/project/ProjectArtifactsService", () => ({
  copyProjectVersionArtifactsInBucket: copyProjectVersionArtifactsInBucketMock,
  deleteProjectVersionArtifactsFromBucket: deleteProjectVersionArtifactsFromBucketMock,
  uploadProjectSourceToBucket: uploadProjectSourceToBucketMock,
  uploadProjectPreviewToBucket: uploadProjectPreviewToBucketMock,
}));

vi.mock("../src/services/project/ProjectArtifactStateService", () => ({
  downloadArtifactToDirectory: downloadArtifactToDirectoryMock,
}));

import { projectCopyService } from "../src/services/project/ProjectCopyService";

function sourceProject(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    slug: "atco",
    title: "ATCO",
    source: "scratch",
    url: "",
    description: "Original project",
    currentVersion: 3,
    tags: ["client", "published"],
    publicPreviewEnabled: true,
    createdAt: new Date("2026-04-28T08:00:00Z"),
    updatedAt: new Date("2026-04-28T08:00:00Z"),
    ...overrides,
  };
}

function sourceVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    organizationId: "org-1",
    projectSlug: "atco",
    version: 3,
    source: "scratch",
    url: "",
    title: "ATCO",
    description: "Original version",
    status: "completed",
    errorMessage: null,
    thumbnailKey: "tenants/org-1/projects/atco/v3/thumbnails/thumbnail.webp",
    startedAt: new Date("2026-04-28T08:00:00Z"),
    createdAt: new Date("2026-04-28T08:00:00Z"),
    updatedAt: new Date("2026-04-28T08:00:00Z"),
    ...overrides,
  };
}

function writeSourceProject(slug = "atco", version = 3): string {
  const versionDir = path.join(state.projectsRoot, "org-1", slug, `v${version}`);
  fs.mkdirSync(path.join(versionDir, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(versionDir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(versionDir, ".astro"), { recursive: true });
  fs.mkdirSync(path.join(versionDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(versionDir, "package.json"), "{}", "utf-8");
  fs.writeFileSync(path.join(versionDir, "index.html"), "<html></html>", "utf-8");
  fs.writeFileSync(path.join(versionDir, "node_modules", "left-pad.js"), "", "utf-8");
  fs.writeFileSync(path.join(versionDir, ".git", "config"), "", "utf-8");
  fs.writeFileSync(path.join(versionDir, ".astro", "data.json"), "{}", "utf-8");
  fs.writeFileSync(path.join(versionDir, "dist", "index.html"), "<html></html>", "utf-8");
  return versionDir;
}

describe("ProjectCopyService", () => {
  beforeEach(() => {
    state.projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-copy-service-"));

    getProjectMock.mockReset();
    getProjectVersionMock.mockReset();
    getNextVersionMock.mockReset();
    createProjectVersionMock.mockReset();
    setTagsMock.mockReset();
    setVersionThumbnailKeyMock.mockReset();
    copyProjectVersionArtifactsInBucketMock.mockReset();
    deleteProjectVersionArtifactsFromBucketMock.mockReset();
    uploadProjectSourceToBucketMock.mockReset();
    uploadProjectPreviewToBucketMock.mockReset();
    downloadArtifactToDirectoryMock.mockReset();
    initializeGitRepositoryMock.mockReset();
    getCurrentCommitMock.mockReset();
    detectProjectTypeMock.mockReset();

    getProjectMock.mockImplementation((_organizationId: string, slug: string) =>
      slug === "atco" ? sourceProject() : null,
    );
    getProjectVersionMock.mockResolvedValue(sourceVersion());
    getNextVersionMock.mockResolvedValue(4);
    copyProjectVersionArtifactsInBucketMock.mockResolvedValue({
      copied: true,
      objectsCopied: 4,
    });
    deleteProjectVersionArtifactsFromBucketMock.mockResolvedValue({
      deleted: true,
      objectsDeleted: 0,
    });
    uploadProjectSourceToBucketMock.mockResolvedValue({ uploaded: true });
    uploadProjectPreviewToBucketMock.mockResolvedValue({ uploaded: true });
    initializeGitRepositoryMock.mockResolvedValue(true);
    getCurrentCommitMock.mockResolvedValue("commit-1");
    detectProjectTypeMock.mockReturnValue({
      framework: "astro",
      mode: "devserver",
      packageManager: "npm",
    });
  });

  afterEach(() => {
    fs.rmSync(state.projectsRoot, { recursive: true, force: true });
  });

  it("duplicates a completed project version without copying runtime directories", async () => {
    const sourceDir = writeSourceProject("atco", 3);

    const result = await projectCopyService.duplicateProject({
      organizationId: "org-1",
      sourceSlug: "atco",
      sourceVersion: 3,
      title: "ATCO Copy",
      slug: "atco-copy",
    });

    const targetDir = path.join(state.projectsRoot, "org-1", "atco-copy", "v1");

    expect(result).toMatchObject({
      success: true,
      sourceSlug: "atco",
      sourceVersion: 3,
      targetSlug: "atco-copy",
      targetVersion: 1,
      artifactsCopied: 4,
    });
    expect(fs.existsSync(path.join(targetDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, ".astro"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, "dist", "index.html"))).toBe(true);

    expect(initializeGitRepositoryMock).toHaveBeenCalledWith(
      targetDir,
      "Copy from atco v3",
    );
    expect(uploadProjectSourceToBucketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        slug: "atco-copy",
        version: 1,
        versionDir: targetDir,
      }),
    );
    expect(uploadProjectPreviewToBucketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localDir: path.join(sourceDir, "dist"),
        slug: "atco-copy",
        version: 1,
      }),
    );
    expect(createProjectVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        slug: "atco-copy",
        version: 1,
        title: "ATCO Copy",
        status: "completed",
      }),
    );
    expect(setTagsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "atco-copy",
      tags: ["client", "published"],
    });
    expect(setVersionThumbnailKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "atco-copy",
        version: 1,
        thumbnailKey: "tenants/org-1/projects/atco-copy/v1/thumbnails/thumbnail.webp",
      }),
    );
  });

  it("hydrates source artifacts when duplicating without a local source dir", async () => {
    getProjectMock.mockImplementation((_organizationId: string, slug: string) =>
      slug === "atco" ? sourceProject({ currentVersion: 1 }) : null,
    );
    getProjectVersionMock.mockResolvedValue(sourceVersion({ version: 1 }));
    downloadArtifactToDirectoryMock.mockImplementation(async (options: any) => {
      fs.mkdirSync(options.destinationDir, { recursive: true });
      fs.writeFileSync(
        path.join(options.destinationDir, "package.json"),
        "{}",
        "utf-8",
      );
      return { downloaded: true, filesDownloaded: 1 };
    });

    const result = await projectCopyService.duplicateProject({
      organizationId: "org-1",
      sourceSlug: "atco",
      sourceVersion: 1,
      title: "ATCO Copy",
      slug: "atco-copy",
    });

    const targetDir = path.join(state.projectsRoot, "org-1", "atco-copy", "v1");

    expect(result).toMatchObject({
      success: true,
      sourceSlug: "atco",
      sourceVersion: 1,
      targetSlug: "atco-copy",
      targetVersion: 1,
    });
    expect(downloadArtifactToDirectoryMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      slug: "atco",
      version: 1,
      kind: "source",
      destinationDir: targetDir,
    });
    expect(fs.existsSync(path.join(targetDir, "package.json"))).toBe(true);
    expect(createProjectVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "atco-copy",
        version: 1,
        status: "completed",
      }),
    );
  });
});
