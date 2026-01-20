import * as fs from "fs";
import * as path from "path";

export const VIVD_DIRNAME = ".vivd";

export const VIVD_INTERNAL_ARTIFACT_FILENAMES = [
  "project.json",
  "website_text.txt",
  "image-files-description.txt",
  "screenshot.png",
  "header_screenshot.png",
] as const;

export type VivdInternalArtifactFilename =
  (typeof VIVD_INTERNAL_ARTIFACT_FILENAMES)[number];

export function getVivdInternalFilesDir(versionDir: string): string {
  return path.join(versionDir, VIVD_DIRNAME);
}

export function ensureVivdInternalFilesDir(versionDir: string): string {
  const dir = getVivdInternalFilesDir(versionDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getVivdInternalFilesPath(
  versionDir: string,
  filename: VivdInternalArtifactFilename | string
): string {
  return path.join(getVivdInternalFilesDir(versionDir), filename);
}

export function hasDotSegment(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.some((seg) => seg.startsWith(".") && seg !== VIVD_DIRNAME);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function uniqueLegacyPath(dir: string, filename: string): string {
  const parsed = path.parse(filename);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(
      dir,
      `${parsed.name}.legacy-${Date.now()}-${i}${parsed.ext}`
    );
    if (!fs.existsSync(candidate)) return candidate;
    i++;
  }
}

export type VivdProcessMigrationResult = {
  versionDir: string;
  moved: Array<{
    filename: VivdInternalArtifactFilename;
    from: string;
    to: string;
  }>;
  movedToLegacy: Array<{
    filename: VivdInternalArtifactFilename;
    from: string;
    to: string;
  }>;
};

/**
 * Moves legacy vivd process files from the version root into `.vivd/`.
 * If destination already exists, moves the source into `.vivd/_legacy/` to avoid data loss.
 */
export function migrateVivdInternalArtifactsInVersion(
  versionDir: string
): VivdProcessMigrationResult {
  const result: VivdProcessMigrationResult = {
    versionDir,
    moved: [],
    movedToLegacy: [],
  };

  for (const filename of VIVD_INTERNAL_ARTIFACT_FILENAMES) {
    const from = path.join(versionDir, filename);
    if (!fs.existsSync(from)) continue;

    const to = getVivdInternalFilesPath(versionDir, filename);
    ensureVivdInternalFilesDir(versionDir);

    if (fs.existsSync(to)) {
      const legacyDir = path.join(getVivdInternalFilesDir(versionDir), "_legacy");
      ensureDir(legacyDir);
      const legacyTarget = uniqueLegacyPath(legacyDir, filename);
      fs.renameSync(from, legacyTarget);
      result.movedToLegacy.push({ filename, from, to: legacyTarget });
      continue;
    }

    fs.renameSync(from, to);
    result.moved.push({ filename, from, to });
  }

  return result;
}
