import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INITIAL_GENERATION_MANIFEST_RELATIVE_PATH,
  INITIAL_GENERATION_MANIFEST_VERSION,
  type ScratchCreationMode,
  type ModelSelection,
  type ScratchInitialGenerationManifest,
} from "@vivd/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASTRO_STARTER_DIR = path.join(__dirname, "templates", "astro-starter");

function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getScratchCreationMode(): ScratchCreationMode {
  return process.env.VIVD_SCRATCH_CREATION_MODE === "legacy_html"
    ? "legacy_html"
    : "studio_astro";
}

export function isStudioAstroScratchCreationEnabled(): boolean {
  return getScratchCreationMode() === "studio_astro";
}

export function applyScratchAstroStarter(options: {
  versionDir: string;
  overwrite?: boolean;
}): void {
  if (!fs.existsSync(ASTRO_STARTER_DIR)) {
    throw new Error(`Astro starter template not found: ${ASTRO_STARTER_DIR}`);
  }

  fs.cpSync(ASTRO_STARTER_DIR, options.versionDir, {
    recursive: true,
    force: options.overwrite ?? false,
    errorOnExist: false,
  });
}

export function createScratchInitialGenerationManifest(input: {
  title: string;
  description: string;
  businessType?: string;
  stylePreset?: string;
  stylePalette?: string[];
  styleMode?: "exact" | "reference";
  siteTheme?: "dark" | "light";
  referenceUrls?: string[];
  model?: ModelSelection;
}): ScratchInitialGenerationManifest {
  return {
    version: INITIAL_GENERATION_MANIFEST_VERSION,
    flow: "scratch",
    mode: "studio_astro",
    state: "draft",
    title: input.title,
    description: input.description,
    businessType: input.businessType,
    stylePreset: input.stylePreset,
    stylePalette: input.stylePalette,
    styleMode: input.styleMode,
    siteTheme: input.siteTheme,
    referenceUrls: input.referenceUrls,
    model: input.model,
    sessionId: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
  };
}

export function getInitialGenerationManifestPath(versionDir: string): string {
  return path.join(versionDir, INITIAL_GENERATION_MANIFEST_RELATIVE_PATH);
}

export function writeInitialGenerationManifest(
  versionDir: string,
  manifest: ScratchInitialGenerationManifest,
): void {
  const manifestPath = getInitialGenerationManifestPath(versionDir);
  ensureDirectory(path.dirname(manifestPath));
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
}

export function readInitialGenerationManifest(
  versionDir: string,
): ScratchInitialGenerationManifest | null {
  const manifestPath = getInitialGenerationManifestPath(versionDir);
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as ScratchInitialGenerationManifest | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
