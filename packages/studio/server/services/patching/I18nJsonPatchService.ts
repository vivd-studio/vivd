import fs from "fs-extra";
import path from "path";

export interface I18nJsonPatch {
  key: string;
  lang: string;
  value: string;
}

export interface ApplyI18nJsonPatchesResult {
  applied: number;
  skipped: number;
  errors: Array<{ key: string; reason: string }>;
}

/**
 * Possible locations for locale JSON files, in order of preference.
 */
const LOCALE_PATHS = ["locales", "src/locales"];

/**
 * Find the locale file for a given language.
 * Returns the path if found, or null if not found.
 */
function findLocaleFile(projectDir: string, lang: string): string | null {
  for (const localeDir of LOCALE_PATHS) {
    const filePath = path.join(projectDir, localeDir, `${lang}.json`);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Get the default path for creating a new locale file.
 * Prefers existing locale directories, otherwise uses `locales/`.
 */
function getDefaultLocalePath(projectDir: string, lang: string): string {
  // Check if any locale directory already exists
  for (const localeDir of LOCALE_PATHS) {
    const dirPath = path.join(projectDir, localeDir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      return path.join(dirPath, `${lang}.json`);
    }
  }
  // Default to locales/ in project root
  return path.join(projectDir, "locales", `${lang}.json`);
}

/**
 * Read a JSON file, returning an empty object if the file doesn't exist or is invalid.
 */
function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write a JSON file, creating parent directories if needed.
 * Only writes if content actually changed to avoid reformatting-only diffs.
 * Returns true if file was written, false if skipped (no change).
 */
function writeJsonFile(
  filePath: string,
  data: Record<string, unknown>
): boolean {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const newContent = JSON.stringify(data, null, 2) + "\n";

  // Check if file exists and content is the same
  if (fs.existsSync(filePath)) {
    const existingContent = fs.readFileSync(filePath, "utf-8");
    if (existingContent === newContent) {
      return false; // No actual change
    }
  }

  fs.writeFileSync(filePath, newContent, "utf-8");
  return true;
}

/**
 * Apply i18n patches to JSON locale files.
 *
 * Patches are grouped by language, then applied to the corresponding locale file.
 * If no locale file exists for a language, one is created in the default location.
 *
 * @param projectDir - Absolute path to the project directory
 * @param patches - Array of I18nJsonPatch objects
 */
export function applyI18nJsonPatches(
  projectDir: string,
  patches: I18nJsonPatch[]
): ApplyI18nJsonPatchesResult {
  const result: ApplyI18nJsonPatchesResult = {
    applied: 0,
    skipped: 0,
    errors: [],
  };

  if (!patches.length) {
    return result;
  }

  // Group patches by language
  const patchesByLang = new Map<string, I18nJsonPatch[]>();
  for (const patch of patches) {
    const existing = patchesByLang.get(patch.lang) ?? [];
    existing.push(patch);
    patchesByLang.set(patch.lang, existing);
  }

  // Apply patches for each language
  for (const [lang, langPatches] of patchesByLang.entries()) {
    // Find existing locale file or determine where to create one
    let localePath = findLocaleFile(projectDir, lang);
    const isNewFile = !localePath;

    if (!localePath) {
      localePath = getDefaultLocalePath(projectDir, lang);
    }

    // Read existing content (or start with empty object)
    let localeData: Record<string, unknown>;
    try {
      localeData = isNewFile ? {} : readJsonFile(localePath);
    } catch (err) {
      // If we can't read the file, skip all patches for this language
      for (const patch of langPatches) {
        result.skipped++;
        result.errors.push({
          key: patch.key,
          reason: `Failed to read locale file: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
      continue;
    }

    // Apply each patch
    let modified = false;
    for (const patch of langPatches) {
      const currentValue = localeData[patch.key];

      // Skip if value is unchanged
      if (currentValue === patch.value) {
        result.skipped++;
        continue;
      }

      localeData[patch.key] = patch.value;
      modified = true;
      result.applied++;
    }

    // Write back if modified
    if (modified) {
      try {
        writeJsonFile(localePath, localeData);
      } catch (err) {
        // Count the modifications as errors if write fails
        result.errors.push({
          key: `${lang}/*`,
          reason: `Failed to write locale file: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  return result;
}

/**
 * Check if a patch array contains any i18n JSON patches
 */
export function hasI18nPatches(patches: Array<{ type: string }>): boolean {
  return patches.some((p) => p.type === "setI18n");
}

/**
 * Extract only i18n patches from a mixed patch array
 */
export function extractI18nPatches(
  patches: Array<{ type: string }>
): I18nJsonPatch[] {
  return patches
    .filter(
      (
        p
      ): p is { type: "setI18n"; key: string; lang: string; value: string } =>
        p.type === "setI18n"
    )
    .map((p) => ({ key: p.key, lang: p.lang, value: p.value }));
}
