import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import type { Multer } from "multer";

import { getProjectDir, getVersionDir } from "../generator/versionUtils";
import { initializeGitRepository } from "../generator/gitUtils";
import { ensureVivdInternalFilesDir } from "../generator/vivdPaths";
import { projectMetaService } from "../services/ProjectMetaService";
import { createContext } from "../trpc";

type AuthLike = {
  api: {
    getSession: (args: { headers: any }) => Promise<unknown>;
  };
};

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

function findExtractRoot(extractedDir: string): string | null {
  const hasProjectJson = (dir: string) =>
    fs.existsSync(path.join(dir, "project.json")) ||
    fs.existsSync(path.join(dir, ".vivd", "project.json"));

  if (hasProjectJson(extractedDir)) return extractedDir;

  const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1) {
    const candidate = path.join(extractedDir, dirs[0].name);
    if (hasProjectJson(candidate)) return candidate;
  }

  return null;
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

      const role = session.user.role ?? "user";
      if (role === "client_editor") {
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
            "Invalid ZIP structure: expected project.json (or .vivd/project.json) at root (or inside a single top-level folder)",
        });
      }

      const sourceProjectJsonPath = fs.existsSync(
        path.join(rootDir, ".vivd", "project.json")
      )
        ? path.join(rootDir, ".vivd", "project.json")
        : path.join(rootDir, "project.json");

      const rawProjectData = JSON.parse(
        fs.readFileSync(sourceProjectJsonPath, "utf-8")
      ) as Record<string, unknown>;

      const url =
        typeof rawProjectData.url === "string" ? rawProjectData.url : "";
      const title =
        typeof rawProjectData.title === "string" ? rawProjectData.title : "";
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
        typeof req.query.slug === "string" ? req.query.slug : "";
      const slugBase = requestedSlug.trim()
        ? requestedSlug.trim().toLowerCase()
        : url
        ? getSlugFromUrl(url)
        : title
        ? slugifyTitle(title)
        : "project";
      const organizationId = requestContext.organizationId;
      if (!organizationId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
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
