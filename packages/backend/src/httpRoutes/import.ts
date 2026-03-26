import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import type { Multer } from "multer";

import { detectProjectType } from "../devserver/projectType";
import { getProjectDir, getVersionDir } from "../generator/versionUtils";
import { initializeGitRepository } from "../generator/gitUtils";
import { ensureVivdInternalFilesDir } from "../generator/vivdPaths";
import { buildService } from "../services/project/BuildService";
import { projectMetaService } from "../services/project/ProjectMetaService";
import {
  uploadProjectPreviewToBucket,
  uploadProjectSourceToBucket,
} from "../services/project/ProjectArtifactsService";
import { gitService } from "../services/integrations/GitService";
import { createContext } from "../trpc";
import { checkOrganizationAccess } from "../lib/organizationAccess";
import { normalizeOrganizationId } from "../lib/organizationIdentifiers";

type AuthLike = {
  api: {
    getSession: (args: { headers: any }) => Promise<unknown>;
  };
};

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!SLUG_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function slugifyTitle(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "project";
}

function getSlugFromUrl(targetUrl: string): string {
  try {
    const normalized = targetUrl.trim();
    const url = normalized.startsWith("http")
      ? normalized
      : `https://${normalized}`;
    const hostname = new URL(url).hostname.replace("www.", "");
    return hostname.split(".")[0] || "project";
  } catch {
    return "project";
  }
}

async function slugExists(
  organizationId: string,
  slug: string,
): Promise<boolean> {
  const existing = await projectMetaService.getProject(organizationId, slug);
  if (existing) return true;
  return fs.existsSync(getProjectDir(organizationId, slug));
}

async function findAvailableSlug(
  organizationId: string,
  baseSlug: string,
): Promise<string> {
  const normalizedBase = baseSlug.trim().toLowerCase();
  if (!(await slugExists(organizationId, normalizedBase))) return normalizedBase;

  let i = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${normalizedBase}-${i}`;
    if (!(await slugExists(organizationId, candidate))) return candidate;
    i++;
  }
}

function containsSymlink(targetDir: string): boolean {
  const stack = [targetDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) return true;
      if (stat.isDirectory()) stack.push(fullPath);
    }
  }
  return false;
}

function hasProjectMetadata(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "project.json")) ||
    fs.existsSync(path.join(dir, ".vivd", "project.json")) ||
    fs.existsSync(path.join(dir, "manifest.json"))
  );
}

function hasAstroConfig(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "astro.config.mjs")) ||
    fs.existsSync(path.join(dir, "astro.config.js")) ||
    fs.existsSync(path.join(dir, "astro.config.ts")) ||
    fs.existsSync(path.join(dir, "astro.config.cjs"))
  );
}

function isLikelyProjectRoot(dir: string): boolean {
  if (hasProjectMetadata(dir)) return true;
  if (fs.existsSync(path.join(dir, "index.html"))) return true;
  if (fs.existsSync(path.join(dir, "package.json"))) return true;
  if (hasAstroConfig(dir)) return true;
  return false;
}

function findExtractRoot(extractedDir: string): string | null {
  if (isLikelyProjectRoot(extractedDir)) return extractedDir;

  const entries = fs
    .readdirSync(extractedDir, { withFileTypes: true })
    // Ignore macOS zip metadata folder when picking a single top-level root.
    .filter((entry) => entry.name !== "__MACOSX");
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) {
    const candidate = path.join(extractedDir, dirs[0].name);
    if (isLikelyProjectRoot(candidate)) return candidate;
  }

  return null;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readImportedProjectMetadata(rootDir: string): Record<string, unknown> {
  const candidates = [
    path.join(rootDir, ".vivd", "project.json"),
    path.join(rootDir, "project.json"),
    path.join(rootDir, "manifest.json"),
  ];

  for (const candidate of candidates) {
    const parsed = readJsonObject(candidate);
    if (parsed) return parsed;
  }

  return {};
}

function hasVisibleSourceFiles(versionDir: string): boolean {
  const excludedDirNames = new Set([
    "node_modules",
    "dist",
    ".astro",
    ".git",
    ".vivd",
    "__MACOSX",
  ]);

  const stack: string[] = [versionDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (excludedDirNames.has(entry.name)) continue;

      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (entry.isFile()) return true;
    }
  }

  return false;
}

function promoteDistToRoot(versionDir: string): boolean {
  const distDir = path.join(versionDir, "dist");
  const distIndexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(distIndexPath)) return false;

  const entries = fs.readdirSync(distDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(distDir, entry.name);
    const dest = path.join(versionDir, entry.name);
    if (fs.existsSync(dest)) continue;
    fs.cpSync(src, dest, { recursive: true });
  }

  try {
    fs.rmSync(distDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  return true;
}

async function syncImportedArtifacts(options: {
  organizationId: string;
  slug: string;
  version: number;
  versionDir: string;
}): Promise<void> {
  const projectConfig = detectProjectType(options.versionDir);
  const commitHash = await gitService.getCurrentCommit(options.versionDir);
  const completedAt = new Date().toISOString();

  await uploadProjectSourceToBucket({
    organizationId: options.organizationId,
    versionDir: options.versionDir,
    slug: options.slug,
    version: options.version,
    meta: {
      status: "ready",
      framework: projectConfig.framework,
      commitHash: commitHash ?? undefined,
      completedAt,
    },
  });

  if (projectConfig.framework !== "astro") return;

  const existingDistDir = path.join(options.versionDir, "dist");
  const previewDir = fs.existsSync(path.join(existingDistDir, "index.html"))
    ? existingDistDir
    : await buildService.buildSync(options.versionDir, "dist");

  await uploadProjectPreviewToBucket({
    organizationId: options.organizationId,
    localDir: previewDir,
    slug: options.slug,
    version: options.version,
    meta: {
      status: "ready",
      framework: "astro",
      commitHash: commitHash ?? undefined,
      completedAt: new Date().toISOString(),
    },
  });
}

export function createImportRouter(deps: { auth: AuthLike; upload: Multer }) {
  const router = express.Router();
  const { upload } = deps;

  router.post("/import", upload.single("file"), async (req, res) => {
    let tmpDir: string | null = null;
    let createdProjectDir: string | null = null;

    try {
      const requestContext = await createContext({ req, res } as any);
      const session = requestContext.session;

      if (!session) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const requestedOrganizationId =
        req.query.organizationId !== undefined
          ? normalizeOrganizationId(req.query.organizationId)
          : "";
      if (req.query.organizationId !== undefined && !requestedOrganizationId) {
        return res.status(400).json({ error: "Invalid organizationId" });
      }
      const organizationId =
        requestedOrganizationId || requestContext.organizationId;
      if (!organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // On tenant-pinned hosts, do not allow overriding the org via query params.
      if (
        requestContext.hostOrganizationId &&
        requestedOrganizationId &&
        requestedOrganizationId !== requestContext.hostOrganizationId
      ) {
        return res.status(400).json({
          error: "Organization selection is pinned to this domain",
        });
      }

      if (session.user.role === "client_editor") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const access = await checkOrganizationAccess({
        session,
        organizationId,
      });
      if (!access.ok) {
        if ("reason" in access && access.reason === "organization_suspended") {
          return res.status(403).json({ error: "Organization is suspended" });
        }
        return res.status(403).json({ error: "Forbidden" });
      }

      if (!access.isSuperAdmin && access.organizationRole === "client_editor") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ error: "Missing file" });
      }

      const originalName = file.originalname || "project.zip";
      if (!originalName.toLowerCase().endsWith(".zip")) {
        return res.status(400).json({ error: "Only .zip files are supported" });
      }

      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vivd-import-"));
      const zipPath = path.join(tmpDir, `upload-${randomUUID()}.zip`);
      fs.writeFileSync(zipPath, file.buffer);

      const extractedDir = path.join(tmpDir, "extracted");
      fs.mkdirSync(extractedDir, { recursive: true });

      const { default: extractZip } = await import("extract-zip");
      await extractZip(zipPath, { dir: extractedDir });

      const rootDir = findExtractRoot(extractedDir);
      if (!rootDir) {
        return res.status(400).json({
          error:
            "Invalid ZIP structure: expected a project root with index.html, package.json/astro.config.*, or project metadata (project.json/.vivd/project.json/manifest.json)",
        });
      }

      const rawProjectData = readImportedProjectMetadata(rootDir);
      const filenameTitle = path
        .basename(originalName, path.extname(originalName))
        .replace(/[-_]+/g, " ")
        .trim();

      const url =
        typeof rawProjectData.url === "string" ? rawProjectData.url : "";
      const title =
        typeof rawProjectData.title === "string" && rawProjectData.title.trim()
          ? rawProjectData.title.trim()
          : filenameTitle;
      const description =
        typeof rawProjectData.description === "string"
          ? rawProjectData.description
          : "";
      const sourceRaw =
        typeof rawProjectData.source === "string" ? rawProjectData.source : "";
      const source: "url" | "scratch" =
        sourceRaw === "scratch" ? "scratch" : url ? "url" : "scratch";

      const createdAtRaw =
        typeof rawProjectData.createdAt === "string"
          ? rawProjectData.createdAt
          : "";
      const createdAt = Number.isFinite(Date.parse(createdAtRaw))
        ? createdAtRaw
        : new Date().toISOString();
      const status =
        typeof rawProjectData.status === "string"
          ? rawProjectData.status
          : "completed";

      const requestedSlug =
        req.query.slug !== undefined ? (normalizeSlug(req.query.slug) ?? "") : "";
      if (req.query.slug !== undefined && !requestedSlug) {
        return res.status(400).json({ error: "Invalid slug" });
      }
      const slugBase = requestedSlug.trim()
        ? requestedSlug.trim().toLowerCase()
        : url
        ? getSlugFromUrl(url)
        : title
        ? slugifyTitle(title)
        : "project";
      const slug = await findAvailableSlug(organizationId, slugBase);

      const projectDir = getProjectDir(organizationId, slug);
      const version = 1;
      const versionDir = getVersionDir(organizationId, slug, version);

      if (fs.existsSync(projectDir)) {
        return res.status(409).json({
          error: "Project already exists",
        });
      }

      // Avoid importing a git repository; we re-initialize for safety/consistency.
      const importedGitDir = path.join(rootDir, ".git");
      if (fs.existsSync(importedGitDir)) {
        fs.rmSync(importedGitDir, { recursive: true, force: true });
      }

      if (containsSymlink(rootDir)) {
        return res.status(400).json({
          error: "Invalid ZIP: symbolic links are not supported",
        });
      }

      fs.mkdirSync(projectDir, { recursive: true });
      createdProjectDir = projectDir;
      fs.cpSync(rootDir, versionDir, { recursive: true });

      // DB is the source of truth for project metadata.
      // Remove any imported metadata files to avoid confusion.
      try {
        const legacyRootProjectJson = path.join(versionDir, "project.json");
        if (fs.existsSync(legacyRootProjectJson)) {
          fs.rmSync(legacyRootProjectJson, { force: true });
        }

        const vivdProjectJson = path.join(versionDir, ".vivd", "project.json");
        if (fs.existsSync(vivdProjectJson)) {
          fs.rmSync(vivdProjectJson, { force: true });
        }
      } catch {
        // ignore
      }

      // In bucket-first mode, studio hydrates from `source/` and intentionally excludes `dist/`.
      // Some exported ZIPs may contain only build output under `dist/` plus metadata files. In
      // that case, promote `dist/*` to the version root so the studio has editable files.
      if (!hasVisibleSourceFiles(versionDir)) {
        promoteDistToRoot(versionDir);
      }

      ensureVivdInternalFilesDir(versionDir);

      await projectMetaService.createProjectVersion({
        organizationId,
        slug,
        version,
        source,
        url,
        title,
        description,
        status,
        createdAt: new Date(createdAt),
      });

      try {
        await initializeGitRepository(versionDir, "Imported project");
      } catch (e) {
        console.warn("[Import] Failed to initialize git:", e);
      }

      await syncImportedArtifacts({
        organizationId,
        slug,
        version,
        versionDir,
      });

      return res.json({
        success: true,
        slug,
        version,
      });
    } catch (error) {
      console.error("Import error:", error);
      if (createdProjectDir && fs.existsSync(createdProjectDir)) {
        try {
          fs.rmSync(createdProjectDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
      return res.status(500).json({ error: "Import failed" });
    } finally {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  });

  return router;
}
