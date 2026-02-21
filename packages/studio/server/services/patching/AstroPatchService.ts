import fs from "fs-extra";
import path from "path";

export interface AstroTextPatch {
  type: "setAstroText";
  /** Relative path from project root, e.g. "src/components/Hero.astro" */
  sourceFile: string;
  /** Line:column hint from Astro dev server, e.g. "18:8" */
  sourceLoc?: string;
  /** Original text for matching in source file */
  oldValue: string;
  /** New text to replace with */
  newValue: string;
}

export interface ApplyAstroPatchesResult {
  applied: number;
  skipped: number;
  errors: Array<{ file: string; reason: string }>;
}

/**
 * Apply text patches to Astro source files.
 *
 * Unlike HTML patching which uses DOM parsing and XPath selectors,
 * Astro patching uses simple text replacement since:
 * 1. Astro components are templates with mostly static content
 * 2. We have the exact original text from the baseline
 * 3. The dev server provides source file paths
 *
 * @param projectDir - Absolute path to the project directory
 * @param patches - Array of AstroTextPatch objects
 */
export function applyAstroPatches(
  projectDir: string,
  patches: AstroTextPatch[]
): ApplyAstroPatchesResult {
  const result: ApplyAstroPatchesResult = {
    applied: 0,
    skipped: 0,
    errors: [],
  };

  if (!patches.length) {
    return result;
  }

  // Group patches by source file
  const patchesByFile = new Map<string, AstroTextPatch[]>();
  for (const patch of patches) {
    const existing = patchesByFile.get(patch.sourceFile) ?? [];
    existing.push(patch);
    patchesByFile.set(patch.sourceFile, existing);
  }

  // Apply patches file by file
  for (const [relativeFile, filePatches] of patchesByFile.entries()) {
    const absolutePath = path.join(projectDir, relativeFile);

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      result.skipped += filePatches.length;
      result.errors.push({
        file: relativeFile,
        reason: "File not found",
      });
      continue;
    }

    // Read file content
    let content: string;
    try {
      content = fs.readFileSync(absolutePath, "utf-8");
    } catch (err) {
      result.skipped += filePatches.length;
      result.errors.push({
        file: relativeFile,
        reason: `Failed to read file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }

    let modified = content;
    let fileApplied = 0;
    let fileSkipped = 0;

    // Apply each patch
    for (const patch of filePatches) {
      // Normalize whitespace for comparison - Astro may have different indentation
      const oldValueNormalized = patch.oldValue.trim();
      const newValueNormalized = patch.newValue.trim();

      // Skip if no actual change
      if (oldValueNormalized === newValueNormalized) {
        fileSkipped++;
        continue;
      }

      // Try exact match first
      if (modified.includes(patch.oldValue)) {
        // Replace only the first occurrence to avoid unintended changes
        modified = modified.replace(patch.oldValue, patch.newValue);
        fileApplied++;
        continue;
      }

      // Try with normalized whitespace (trim leading/trailing but not internal)
      // This helps when editor adds/removes trailing spaces
      const oldTrimmed = patch.oldValue.trim();
      if (modified.includes(oldTrimmed)) {
        modified = modified.replace(oldTrimmed, patch.newValue.trim());
        fileApplied++;
        continue;
      }

      // Could not find the text to replace
      fileSkipped++;
      result.errors.push({
        file: relativeFile,
        reason: `Text not found: "${patch.oldValue.slice(0, 50)}${
          patch.oldValue.length > 50 ? "..." : ""
        }"`,
      });
    }

    // Write back if any changes were made
    if (fileApplied > 0) {
      try {
        fs.writeFileSync(absolutePath, modified, "utf-8");
      } catch (err) {
        // If write fails, count all as skipped
        result.skipped += fileApplied;
        result.errors.push({
          file: relativeFile,
          reason: `Failed to write file: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        continue;
      }
    }

    result.applied += fileApplied;
    result.skipped += fileSkipped;
  }

  return result;
}

/**
 * Check if a patch array contains any Astro patches
 */
export function hasAstroPatches(patches: Array<{ type: string }>): boolean {
  return patches.some((p) => p.type === "setAstroText");
}

/**
 * Extract only Astro patches from a mixed patch array
 */
export function extractAstroPatches(
  patches: Array<{ type: string }>
): AstroTextPatch[] {
  return patches.filter((p): p is AstroTextPatch => p.type === "setAstroText");
}
