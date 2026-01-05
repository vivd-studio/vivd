import * as fs from "fs";
import {
  createVersionEntry,
  getManifest,
  getNextVersion,
  getProjectDir,
  getVersionDir,
  saveManifest,
  updateVersionStatus,
} from "../versionUtils";
import type { GenerationContext, GenerationSource } from "../flows/types";
import { ensureVivdInternalFilesDir, getVivdInternalFilesPath } from "../vivdPaths";

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
  const hostname = new URL(targetUrl).hostname.replace("www.", "");
  return hostname.split(".")[0] || "project";
}

function findAvailableSlug(baseSlug: string): string {
  const normalizedBase = baseSlug.trim().toLowerCase();
  const baseDir = getProjectDir(normalizedBase);
  if (!fs.existsSync(baseDir)) return normalizedBase;

  let i = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${normalizedBase}-${i}`;
    if (!fs.existsSync(getProjectDir(candidate))) return candidate;
    i++;
  }
}

export interface CreateGenerationContextInput {
  source: GenerationSource;
  url?: string;
  title?: string;
  description?: string;
  slug?: string;
  version?: number;
  allowSlugSuffix?: boolean;
  initialStatus?: string;
}

export function createGenerationContext(
  input: CreateGenerationContextInput
): GenerationContext {
  const now = new Date().toISOString();
  const source = input.source;
  const initialStatus = input.initialStatus ?? "pending";

  let slug: string;
  if (input.slug) {
    slug = input.slug.trim().toLowerCase();
  } else if (source === "url" && input.url) {
    slug = getSlugFromUrl(input.url);
  } else if (input.title) {
    slug = slugifyTitle(input.title);
  } else {
    slug = "project";
  }

  if (input.allowSlugSuffix) {
    slug = findAvailableSlug(slug);
  }

  const version = input.version ?? getNextVersion(slug);
  const projectDir = getProjectDir(slug);
  const outputDir = getVersionDir(slug, version);

  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  createVersionEntry(slug, version, input.url ?? "", initialStatus);

  const manifest = getManifest(slug);
  if (manifest) {
    (manifest as any).source = source;
    if (input.title) (manifest as any).title = input.title;
    if (input.description) (manifest as any).description = input.description;
    if (!manifest.createdAt) manifest.createdAt = now;
    saveManifest(slug, manifest);
  }

  ensureVivdInternalFilesDir(outputDir);
  const projectJsonPath = getVivdInternalFilesPath(outputDir, "project.json");
  const projectData: Record<string, unknown> = {
    source,
    url: input.url ?? "",
    title: input.title ?? "",
    description: input.description ?? "",
    createdAt: now,
    status: initialStatus,
    version,
  };
  fs.writeFileSync(projectJsonPath, JSON.stringify(projectData, null, 2));

  const updateStatus = (status: string) => {
    try {
      const currentData = JSON.parse(fs.readFileSync(projectJsonPath, "utf-8"));
      currentData.status = status;
      fs.writeFileSync(projectJsonPath, JSON.stringify(currentData, null, 2));
    } catch {
      // ignore
    }
    updateVersionStatus(slug, version, status);
  };

  return { source, slug, version, outputDir, updateStatus };
}
