import * as fs from "fs";
import {
  getNextVersion,
  getProjectDir,
  getVersionDir,
} from "../versionUtils";
import type { GenerationContext, GenerationSource } from "../flows/types";
import { ensureVivdInternalFilesDir } from "../vivdPaths";
import { applyProjectTemplateFiles } from "../templateFiles";
import { projectMetaService } from "../../services/ProjectMetaService";

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

async function slugExists(slug: string): Promise<boolean> {
  const existing = await projectMetaService.getProject(slug);
  if (existing) return true;
  return fs.existsSync(getProjectDir(slug));
}

async function findAvailableSlug(baseSlug: string): Promise<string> {
  const normalizedBase = baseSlug.trim().toLowerCase();
  if (!(await slugExists(normalizedBase))) return normalizedBase;

  let i = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${normalizedBase}-${i}`;
    if (!(await slugExists(candidate))) return candidate;
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

export async function createGenerationContext(
  input: CreateGenerationContextInput,
): Promise<GenerationContext> {
  const now = new Date();
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
    slug = await findAvailableSlug(slug);
  }

  const version = input.version ?? (await getNextVersion(slug));
  const projectDir = getProjectDir(slug);
  const outputDir = getVersionDir(slug, version);

  if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  await projectMetaService.createProjectVersion({
    slug,
    version,
    source,
    url: input.url ?? "",
    title: input.title ?? "",
    description: input.description ?? "",
    status: initialStatus,
    createdAt: now,
  });

  ensureVivdInternalFilesDir(outputDir);

  try {
    applyProjectTemplateFiles({
      versionDir: outputDir,
      source,
      projectName: input.title?.trim() || slug,
      overwrite: false,
    });
  } catch (e) {
    console.error(`[Templates] Failed to write template files for ${slug}/v${version}:`, e);
  }

  const updateStatus = (status: string, errorMessage?: string) => {
    void projectMetaService
      .updateVersionStatus({ slug, version, status, errorMessage })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[ProjectMeta] Failed to update status for ${slug}/v${version}: ${message}`);
      });
  };

  return { source, slug, version, outputDir, updateStatus };
}
