import { describe, expect, it } from "vitest";
import { buildUnifiedDiffPreview } from "./unifiedPreview";

describe("buildUnifiedDiffPreview", () => {
  it("renders modified lines with surrounding context", () => {
    const result = buildUnifiedDiffPreview({
      before: ["one", "two", "three"].join("\n"),
      after: ["one", "changed", "three"].join("\n"),
    });

    expect(result.lines).toEqual([
      {
        kind: "context",
        text: "one",
        beforeLineNumber: 1,
        afterLineNumber: 1,
      },
      {
        kind: "removed",
        text: "two",
        beforeLineNumber: 2,
      },
      {
        kind: "added",
        text: "changed",
        afterLineNumber: 2,
      },
      {
        kind: "context",
        text: "three",
        beforeLineNumber: 3,
        afterLineNumber: 3,
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("compresses far-away unchanged lines into omission markers", () => {
    const before = Array.from({ length: 8 }, (_, index) => `line-${index + 1}`);
    const after = [...before];
    after[6] = "line-7 updated";

    const result = buildUnifiedDiffPreview(
      {
        before: before.join("\n"),
        after: after.join("\n"),
      },
      { contextRadius: 1 },
    );

    expect(result.lines).toEqual([
      { kind: "omitted", count: 5 },
      {
        kind: "context",
        text: "line-6",
        beforeLineNumber: 6,
        afterLineNumber: 6,
      },
      {
        kind: "removed",
        text: "line-7",
        beforeLineNumber: 7,
      },
      {
        kind: "added",
        text: "line-7 updated",
        afterLineNumber: 7,
      },
      {
        kind: "context",
        text: "line-8",
        beforeLineNumber: 8,
        afterLineNumber: 8,
      },
    ]);
  });

  it("handles added files without before context", () => {
    const result = buildUnifiedDiffPreview({
      before: "",
      after: ["first", "second"].join("\n"),
    });

    expect(result.lines).toEqual([
      {
        kind: "added",
        text: "first",
        afterLineNumber: 1,
      },
      {
        kind: "added",
        text: "second",
        afterLineNumber: 2,
      },
    ]);
  });

  it("handles deleted files without after context", () => {
    const result = buildUnifiedDiffPreview({
      before: ["first", "second"].join("\n"),
      after: "",
    });

    expect(result.lines).toEqual([
      {
        kind: "removed",
        text: "first",
        beforeLineNumber: 1,
      },
      {
        kind: "removed",
        text: "second",
        beforeLineNumber: 2,
      },
    ]);
  });
});
