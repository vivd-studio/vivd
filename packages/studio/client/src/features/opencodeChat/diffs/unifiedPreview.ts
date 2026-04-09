import type { DetailedFileDiff } from "./types";

export type UnifiedPreviewLine =
  | {
      kind: "context" | "added" | "removed";
      text: string;
      beforeLineNumber?: number;
      afterLineNumber?: number;
    }
  | {
      kind: "omitted";
      count: number;
    };

export type UnifiedDiffPreview = {
  lines: UnifiedPreviewLine[];
  truncated: boolean;
};

function parseUnifiedPatchLines(patch: string): UnifiedPreviewLine[] {
  const lines = patch.replace(/\r\n?/g, "\n").split("\n");
  const parsed: UnifiedPreviewLine[] = [];
  let inHunk = false;
  let beforeLineNumber = 0;
  let afterLineNumber = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      const nextBeforeLineNumber = Number(hunkMatch[1] ?? 0);
      const nextAfterLineNumber = Number(hunkMatch[2] ?? 0);
      const omittedCount = Math.max(
        nextBeforeLineNumber - beforeLineNumber,
        nextAfterLineNumber - afterLineNumber,
      );
      if (inHunk && omittedCount > 0) {
        parsed.push({ kind: "omitted", count: omittedCount });
      }
      beforeLineNumber = nextBeforeLineNumber;
      afterLineNumber = nextAfterLineNumber;
      inHunk = true;
      continue;
    }

    if (!inHunk || line.startsWith("\\ No newline at end of file")) {
      continue;
    }

    const prefix = line[0];
    const text = line.slice(1);

    if (prefix === " ") {
      parsed.push({
        kind: "context",
        text,
        beforeLineNumber,
        afterLineNumber,
      });
      beforeLineNumber += 1;
      afterLineNumber += 1;
      continue;
    }

    if (prefix === "-") {
      parsed.push({
        kind: "removed",
        text,
        beforeLineNumber,
      });
      beforeLineNumber += 1;
      continue;
    }

    if (prefix === "+") {
      parsed.push({
        kind: "added",
        text,
        afterLineNumber,
      });
      afterLineNumber += 1;
    }
  }

  return parsed;
}

function splitLines(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (normalized.length === 0) {
    return [];
  }
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function buildRawDiffLines(before: string[], after: string[]): UnifiedPreviewLine[] {
  const raw: UnifiedPreviewLine[] = [];

  const product = before.length * after.length;
  if (product > 120_000) {
    let beforeLineNumber = 1;
    let afterLineNumber = 1;
    const limit = Math.max(before.length, after.length);
    for (let index = 0; index < limit; index += 1) {
      const beforeLine = before[index];
      const afterLine = after[index];

      if (beforeLine === afterLine && beforeLine !== undefined) {
        raw.push({
          kind: "context",
          text: beforeLine,
          beforeLineNumber,
          afterLineNumber,
        });
        beforeLineNumber += 1;
        afterLineNumber += 1;
        continue;
      }

      if (beforeLine !== undefined) {
        raw.push({
          kind: "removed",
          text: beforeLine,
          beforeLineNumber,
        });
        beforeLineNumber += 1;
      }

      if (afterLine !== undefined) {
        raw.push({
          kind: "added",
          text: afterLine,
          afterLineNumber,
        });
        afterLineNumber += 1;
      }
    }

    return raw;
  }

  const dp = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      if (before[beforeIndex] === after[afterIndex]) {
        dp[beforeIndex][afterIndex] = dp[beforeIndex + 1][afterIndex + 1] + 1;
      } else {
        dp[beforeIndex][afterIndex] = Math.max(
          dp[beforeIndex + 1][afterIndex],
          dp[beforeIndex][afterIndex + 1],
        );
      }
    }
  }

  let beforeIndex = 0;
  let afterIndex = 0;
  let beforeLineNumber = 1;
  let afterLineNumber = 1;

  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      raw.push({
        kind: "context",
        text: before[beforeIndex],
        beforeLineNumber,
        afterLineNumber,
      });
      beforeIndex += 1;
      afterIndex += 1;
      beforeLineNumber += 1;
      afterLineNumber += 1;
      continue;
    }

    if (dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]) {
      raw.push({
        kind: "removed",
        text: before[beforeIndex],
        beforeLineNumber,
      });
      beforeIndex += 1;
      beforeLineNumber += 1;
      continue;
    }

    raw.push({
      kind: "added",
      text: after[afterIndex],
      afterLineNumber,
    });
    afterIndex += 1;
    afterLineNumber += 1;
  }

  while (beforeIndex < before.length) {
    raw.push({
      kind: "removed",
      text: before[beforeIndex],
      beforeLineNumber,
    });
    beforeIndex += 1;
    beforeLineNumber += 1;
  }

  while (afterIndex < after.length) {
    raw.push({
      kind: "added",
      text: after[afterIndex],
      afterLineNumber,
    });
    afterIndex += 1;
    afterLineNumber += 1;
  }

  return raw;
}

export function buildUnifiedDiffPreview(
  diff: Pick<DetailedFileDiff, "patch" | "before" | "after">,
  options?: {
    contextRadius?: number;
    maxLines?: number;
  },
): UnifiedDiffPreview {
  const maxLines = options?.maxLines ?? 180;
  const patch =
    typeof diff.patch === "string" && diff.patch.trim().length > 0
      ? diff.patch
      : null;

  if (patch) {
    const lines = parseUnifiedPatchLines(patch);
    return {
      lines: lines.slice(0, maxLines),
      truncated: lines.length > maxLines,
    };
  }

  const before = typeof diff.before === "string" ? diff.before : "";
  const after = typeof diff.after === "string" ? diff.after : "";
  const rawLines = buildRawDiffLines(splitLines(before), splitLines(after));
  const contextRadius = options?.contextRadius ?? 2;
  const changedIndexes = rawLines
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) {
    return {
      lines: rawLines.slice(0, maxLines),
      truncated: rawLines.length > maxLines,
    };
  }

  const keep = new Set<number>();
  changedIndexes.forEach((index) => {
    const start = Math.max(0, index - contextRadius);
    const end = Math.min(rawLines.length - 1, index + contextRadius);
    for (let cursor = start; cursor <= end; cursor += 1) {
      keep.add(cursor);
    }
  });

  const lines: UnifiedPreviewLine[] = [];
  let omittedCount = 0;

  rawLines.forEach((line, index) => {
    if (keep.has(index)) {
      if (omittedCount > 0) {
        lines.push({ kind: "omitted", count: omittedCount });
        omittedCount = 0;
      }
      lines.push(line);
      return;
    }

    omittedCount += 1;
  });

  if (omittedCount > 0) {
    lines.push({ kind: "omitted", count: omittedCount });
  }

  return {
    lines: lines.slice(0, maxLines),
    truncated: lines.length > maxLines,
  };
}
