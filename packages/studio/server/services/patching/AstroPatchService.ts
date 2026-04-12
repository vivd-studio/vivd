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

export interface AstroImagePatch {
  type: "setAstroImage";
  /** Relative path from project root, e.g. "src/components/Hero.astro" */
  sourceFile: string;
  /** Line:column hint from Astro dev server, e.g. "18:8" */
  sourceLoc?: string;
  /** Relative path from project root to the dropped asset */
  assetPath: string;
  /** Previous preview/runtime src value when available */
  oldValue?: string;
}

export type AstroPatch = AstroTextPatch | AstroImagePatch;

export interface ApplyAstroPatchesResult {
  applied: number;
  skipped: number;
  errors: Array<{ file: string; reason: string }>;
}

type AstroTextMatch =
  | { kind: "match"; start: number; end: number; value: string }
  | { kind: "ambiguous"; sample: string }
  | { kind: "missing"; sample: string };

type AstroTagCandidate = {
  tagName: "Image" | "img";
  start: number;
  end: number;
  text: string;
};

type AstroImageTagMatch =
  | { kind: "match"; candidate: AstroTagCandidate }
  | { kind: "ambiguous"; reason: string }
  | { kind: "missing"; reason: string };

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

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAstroImageImportName(assetPath: string): string {
  const baseName = path.basename(assetPath, path.extname(assetPath));
  const parts = baseName
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const suffix = parts
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("");
  return suffix ? `vivdImage${suffix}` : "vivdImageAsset";
}

function createUniqueIdentifier(content: string, seed: string): string {
  let candidate = seed;
  let counter = 2;
  while (new RegExp(`\\b${escapeRegExp(candidate)}\\b`).test(content)) {
    candidate = `${seed}${counter}`;
    counter += 1;
  }
  return candidate;
}

function relativeImportPath(fromFile: string, assetPath: string): string {
  const fromDir = path.dirname(fromFile);
  const relative = toPosixPath(path.relative(fromDir, assetPath));
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function parseFrontmatter(content: string): { contentEnd: number } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return null;
  }

  const openingMatch = content.match(/^---\r?\n/);
  if (!openingMatch) {
    return null;
  }

  return {
    contentEnd: openingMatch[0].length + match[1].length,
  };
}

function ensureAstroImageImport(
  source: string,
  sourceFile: string,
  assetPath: string,
): { content: string; importName: string } {
  const normalizedAssetPath = toPosixPath(assetPath).replace(/^\/+/, "");
  const importTarget = relativeImportPath(sourceFile, normalizedAssetPath);
  const existingImportMatch = new RegExp(
    String.raw`(?:^|\n)\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+["']${escapeRegExp(importTarget)}["'];?`,
    "m",
  ).exec(source);
  if (existingImportMatch?.[1]) {
    return { content: source, importName: existingImportMatch[1] };
  }

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const importName = createUniqueIdentifier(
    source,
    buildAstroImageImportName(normalizedAssetPath),
  );
  const importStatement = `import ${importName} from "${importTarget}";`;
  const frontmatter = parseFrontmatter(source);

  if (frontmatter) {
    const needsLeadingBreak =
      source.slice(0, frontmatter.contentEnd).trim().length > 0;
    const insertion = `${needsLeadingBreak ? lineEnding : ""}${importStatement}`;
    return {
      content:
        source.slice(0, frontmatter.contentEnd) +
        insertion +
        source.slice(frontmatter.contentEnd),
      importName,
    };
  }

  return {
    content: `---${lineEnding}${importStatement}${lineEnding}---${lineEnding}${lineEnding}${source}`,
    importName,
  };
}

function distanceToRange(offset: number, start: number, end: number): number {
  if (offset < start) return start - offset;
  if (offset > end) return offset - end;
  return 0;
}

function findTagEnd(content: string, start: number): number | null {
  let quote: '"' | "'" | null = null;
  let braceDepth = 0;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      continue;
    }

    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (char === ">" && braceDepth === 0) {
      return index;
    }
  }

  return null;
}

function collectImageTagCandidates(content: string): AstroTagCandidate[] {
  const candidates: AstroTagCandidate[] = [];
  const tagPattern = /<(Image|img)\b/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content))) {
    const start = match.index;
    const end = findTagEnd(content, start);
    if (end == null) {
      continue;
    }
    candidates.push({
      tagName: match[1] === "Image" ? "Image" : "img",
      start,
      end,
      text: content.slice(start, end + 1),
    });
  }

  return candidates;
}

function findTargetImageTag(
  content: string,
  sourceLoc?: string,
  oldValue?: string,
): AstroImageTagMatch {
  const candidates = collectImageTagCandidates(content);
  if (candidates.length === 0) {
    return { kind: "missing", reason: "No Astro image tag found near this element" };
  }

  const targetOffset = parseSourceOffset(content, sourceLoc);
  if (targetOffset != null) {
    const best = candidates.reduce((currentBest, candidate) => {
      if (!currentBest) return candidate;
      const bestDistance = distanceToRange(
        targetOffset,
        currentBest.start,
        currentBest.end,
      );
      const candidateDistance = distanceToRange(
        targetOffset,
        candidate.start,
        candidate.end,
      );
      return candidateDistance < bestDistance ? candidate : currentBest;
    }, null as AstroTagCandidate | null);
    if (best) {
      return { kind: "match", candidate: best };
    }
  }

  if (oldValue) {
    const matchingCandidates = candidates.filter((candidate) =>
      candidate.text.includes(oldValue),
    );
    if (matchingCandidates.length === 1) {
      return { kind: "match", candidate: matchingCandidates[0] };
    }
    if (matchingCandidates.length > 1) {
      return {
        kind: "ambiguous",
        reason: "Multiple Astro image tags matched the current image source",
      };
    }
  }

  if (candidates.length === 1) {
    return { kind: "match", candidate: candidates[0] };
  }

  return {
    kind: "ambiguous",
    reason: "Multiple Astro image tags were found and Vivd could not match one safely",
  };
}

function findSrcValueRange(tagText: string): { start: number; end: number } | null {
  const attrMatch = /\bsrc\s*=\s*/g.exec(tagText);
  if (!attrMatch) {
    return null;
  }

  let index = attrMatch.index + attrMatch[0].length;
  while (index < tagText.length && /\s/.test(tagText[index] ?? "")) {
    index += 1;
  }

  const opener = tagText[index];
  if (!opener) {
    return null;
  }

  if (opener === '"' || opener === "'") {
    let cursor = index + 1;
    while (cursor < tagText.length) {
      const char = tagText[cursor];
      if (char === "\\") {
        cursor += 2;
        continue;
      }
      if (char === opener) {
        return { start: index, end: cursor + 1 };
      }
      cursor += 1;
    }
    return null;
  }

  if (opener === "{") {
    let cursor = index + 1;
    let quote: '"' | "'" | null = null;
    let depth = 1;
    while (cursor < tagText.length) {
      const char = tagText[cursor];
      if (quote) {
        if (char === "\\") {
          cursor += 2;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        cursor += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        cursor += 1;
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return { start: index, end: cursor + 1 };
        }
      }
      cursor += 1;
    }
  }

  return null;
}

function applyAstroImagePatch(
  content: string,
  patch: AstroImagePatch,
): { applied: boolean; content: string; reason?: string } {
  const tagMatch = findTargetImageTag(content, patch.sourceLoc, patch.oldValue);
  if (tagMatch.kind !== "match") {
    return {
      applied: false,
      content,
      reason: tagMatch.reason,
    };
  }

  const originalTag = tagMatch.candidate;
  const originalSrcRange = findSrcValueRange(originalTag.text);
  if (!originalSrcRange) {
    return {
      applied: false,
      content,
      reason: "The matched Astro image tag does not contain a src attribute Vivd can rewrite",
    };
  }

  const { content: withImport, importName } = ensureAstroImageImport(
    content,
    patch.sourceFile,
    patch.assetPath,
  );
  const contentLengthDelta = withImport.length - content.length;
  const shiftedTagStart = originalTag.start + contentLengthDelta;
  const shiftedTagEnd = originalTag.end + contentLengthDelta;
  const shiftedTagText = withImport.slice(shiftedTagStart, shiftedTagEnd + 1);
  const shiftedSrcRange = findSrcValueRange(shiftedTagText);
  if (!shiftedSrcRange) {
    return {
      applied: false,
      content,
      reason: "Vivd lost track of the Astro image src attribute while preparing the patch",
    };
  }

  const replacementValue =
    originalTag.tagName === "img" ? `{${importName}.src}` : `{${importName}}`;
  const nextTagText =
    shiftedTagText.slice(0, shiftedSrcRange.start) +
    replacementValue +
    shiftedTagText.slice(shiftedSrcRange.end);
  if (nextTagText === shiftedTagText) {
    return {
      applied: false,
      content,
      reason: "The Astro image already points at this asset",
    };
  }

  return {
    applied: true,
    content:
      withImport.slice(0, shiftedTagStart) +
      nextTagText +
      withImport.slice(shiftedTagEnd + 1),
  };
}

/**
 * Apply source-backed patches to Astro files.
 *
 * Text patches still use the existing exact-text matching flow.
 * Image patches are intentionally narrower: Vivd rewrites the nearest
 * Astro `<Image>` or plain `<img>` render point near `sourceLoc` and
 * injects a local asset import for `src/content/media/...` drops.
 */
export function applyAstroPatches(
  projectDir: string,
  patches: AstroPatch[],
): ApplyAstroPatchesResult {
  const result: ApplyAstroPatchesResult = {
    applied: 0,
    skipped: 0,
    errors: [],
  };

  if (!patches.length) {
    return result;
  }

  const patchesByFile = new Map<string, AstroPatch[]>();
  for (const patch of patches) {
    const existing = patchesByFile.get(patch.sourceFile) ?? [];
    existing.push(patch);
    patchesByFile.set(patch.sourceFile, existing);
  }

  for (const [relativeFile, filePatches] of patchesByFile.entries()) {
    const absolutePath = path.join(projectDir, relativeFile);

    if (!fs.existsSync(absolutePath)) {
      result.skipped += filePatches.length;
      result.errors.push({
        file: relativeFile,
        reason: "File not found",
      });
      continue;
    }

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

    for (const patch of filePatches) {
      if (patch.type === "setAstroImage") {
        const imageResult = applyAstroImagePatch(modified, patch);
        if (imageResult.applied) {
          modified = imageResult.content;
          fileApplied++;
          continue;
        }

        fileSkipped++;
        result.errors.push({
          file: relativeFile,
          reason: imageResult.reason ?? "Astro image patch could not be applied",
        });
        continue;
      }

      const oldValueNormalized = patch.oldValue.trim();
      const newValueNormalized = patch.newValue.trim();

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

    if (fileApplied > 0) {
      try {
        fs.writeFileSync(absolutePath, modified, "utf-8");
      } catch (err) {
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

export function hasAstroPatches(patches: Array<{ type: string }>): boolean {
  return patches.some(
    (patch) => patch.type === "setAstroText" || patch.type === "setAstroImage",
  );
}

export function extractAstroPatches(patches: Array<{ type: string }>): AstroPatch[] {
  return patches.filter(
    (patch): patch is AstroPatch =>
      patch.type === "setAstroText" || patch.type === "setAstroImage",
  );
}
