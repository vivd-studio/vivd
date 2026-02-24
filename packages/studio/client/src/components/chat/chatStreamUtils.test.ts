import { describe, expect, it } from "vitest";
import {
  normalizeMessagePart,
  sanitizeThoughtText,
  upsertDeltaStreamingPart,
} from "./chatStreamUtils";

describe("chatStreamUtils reasoning sanitization", () => {
  it("removes [REDACTED] placeholders from thought text", () => {
    const input = `Assessing image\n\n[REDACTED]\n\nNext step`;
    expect(sanitizeThoughtText(input)).toBe("Assessing image\n\nNext step");
  });

  it("returns empty string when thought only contains redacted placeholders", () => {
    expect(sanitizeThoughtText("[REDACTED]")).toBe("");
    expect(sanitizeThoughtText("\n [REDACTED]\n")).toBe("");
  });

  it("does not create streaming reasoning part for redacted-only deltas", () => {
    const next = upsertDeltaStreamingPart([], "r1", "reasoning", "[REDACTED]");
    expect(next).toEqual([]);
  });

  it("keeps non-redacted reasoning while stripping redacted chunks", () => {
    let next = upsertDeltaStreamingPart([], "r1", "reasoning", "Analyzing");
    next = upsertDeltaStreamingPart(next, "r1", "reasoning", "\n[REDACTED]\n");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "r1",
      type: "reasoning",
      text: "Analyzing",
    });
  });

  it("drops persisted reasoning parts that become empty after sanitize", () => {
    const normalized = normalizeMessagePart({
      type: "reasoning",
      text: "[REDACTED]",
    });
    expect(normalized).toBeNull();
  });
});
