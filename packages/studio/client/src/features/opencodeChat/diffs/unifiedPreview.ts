import type { FileDiff } from "@opencode-ai/sdk/v2";

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
  diff: Pick<FileDiff, "before" | "after">,
  options?: {
    contextRadius?: number;
    maxLines?: number;
  },
): UnifiedDiffPreview {
  const rawLines = buildRawDiffLines(splitLines(diff.before), splitLines(diff.after));
  const contextRadius = options?.contextRadius ?? 2;
  const maxLines = options?.maxLines ?? 180;
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
