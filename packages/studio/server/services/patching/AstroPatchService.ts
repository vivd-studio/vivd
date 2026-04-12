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

type AstroTextMatch =
  | { kind: "match"; start: number; end: number; value: string }
  | { kind: "ambiguous"; sample: string }
  | { kind: "missing"; sample: string };

function truncateForReason(value: string): string {
  return `${value.slice(0, 50)}${value.length > 50 ? "..." : ""}`;
}

function parseSourceOffset(content: string, sourceLoc?: string): number | null {
  if (!sourceLoc) return null;
  const match = sourceLoc.match(/^(\d+):(\d+)$/);
  if (!match) return null;

  const line = Number(match[1]);
  const column = Number(match[2]);
  if (!Number.isFinite(line) || !Number.isFinite(column) || line < 1 || column < 1) {
    return null;
  }

  let offset = 0;
  let currentLine = 1;
  while (currentLine < line && offset < content.length) {
    const nextNewline = content.indexOf("\n", offset);
    if (nextNewline === -1) {
      return content.length;
    }
    offset = nextNewline + 1;
    currentLine += 1;
  }

  return Math.min(offset + column - 1, content.length);
}

function findAllOccurrences(content: string, search: string): number[] {
  if (!search) return [];
  const matches: number[] = [];
  let start = 0;
  while (start <= content.length) {
    const index = content.indexOf(search, start);
    if (index === -1) break;
    matches.push(index);
    start = index + search.length;
  }
  return matches;
}

function selectOccurrence(
  content: string,
  search: string,
  sourceLoc?: string,
): AstroTextMatch {
  const occurrences = findAllOccurrences(content, search);
  if (occurrences.length === 0) {
    return { kind: "missing", sample: truncateForReason(search) };
  }

  const targetOffset = parseSourceOffset(content, sourceLoc);
  if (targetOffset != null) {
    const nearest = occurrences.reduce((best, current) =>
      Math.abs(current - targetOffset) < Math.abs(best - targetOffset) ? current : best,
    );
    return {
      kind: "match",
      start: nearest,
      end: nearest + search.length,
      value: search,
    };
  }

  if (occurrences.length > 1) {
    return { kind: "ambiguous", sample: truncateForReason(search) };
  }

  return {
    kind: "match",
    start: occurrences[0]!,
    end: occurrences[0]! + search.length,
    value: search,
  };
}

function resolveAstroTextMatch(content: string, patch: AstroTextPatch): AstroTextMatch {
  const exact = selectOccurrence(content, patch.oldValue, patch.sourceLoc);
  if (exact.kind !== "missing") {
    return exact;
  }

  const trimmed = patch.oldValue.trim();
  if (!trimmed || trimmed === patch.oldValue) {
    return exact;
  }

  return selectOccurrence(content, trimmed, patch.sourceLoc);
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

      const match = resolveAstroTextMatch(modified, patch);
      if (match.kind === "match") {
        const replacement = match.value === patch.oldValue ? patch.newValue : patch.newValue.trim();
        modified = `${modified.slice(0, match.start)}${replacement}${modified.slice(match.end)}`;
        fileApplied++;
        continue;
      }

      fileSkipped++;
      result.errors.push({
        file: relativeFile,
        reason:
          match.kind === "ambiguous"
            ? `Ambiguous text match: "${match.sample}"`
            : `Text not found: "${match.sample}"`,
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
