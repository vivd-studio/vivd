import { describe, expect, it } from "vitest";
import {
  getToolActivityLabel,
  normalizeMessagePart,
  sanitizeThoughtText,
  upsertDeltaStreamingPart,
  upsertToolStartedPart,
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

  it("formats read tool labels with filename and status", () => {
    expect(
      getToolActivityLabel({
        type: "tool",
        tool: "read",
        status: "running",
        input: { path: "src/pages/index.html" },
      }),
    ).toBe("Exploring index.html...");

    expect(
      getToolActivityLabel({
        type: "tool",
        tool: "read",
        status: "completed",
        input: { path: "src/pages/index.html" },
      }),
    ).toBe("Explored index.html");
  });

  it("formats edit tool labels with filename and status", () => {
    expect(
      getToolActivityLabel({
        type: "tool",
        tool: "edit",
        status: "running",
        input: { filePath: "/workspace/schema.ts" },
      }),
    ).toBe("Editing schema.ts...");

    expect(
      getToolActivityLabel({
        type: "tool",
        tool: "edit",
        status: "error",
        input: { filePath: "/workspace/schema.ts" },
      }),
    ).toBe("Failed editing schema.ts");
  });

  it("formats bash tool labels as user-friendly actions", () => {
    expect(
      getToolActivityLabel({
        type: "tool",
        tool: "bash",
        status: "running",
      }),
    ).toBe("Running command...");

    expect(
      getToolActivityLabel({
        type: "tool",
        tool: "bash",
        status: "completed",
      }),
    ).toBe("Executed command");
  });

  it("stores tool input on started parts for live filename labels", () => {
    const parts = upsertToolStartedPart(
      [],
      "tool-1",
      "read",
      "Read file",
      { path: "apps/frontend/main.tsx" },
    );

    expect(parts).toEqual([
      {
        id: "tool-1",
        type: "tool",
        tool: "read",
        title: "Read file",
        input: { path: "apps/frontend/main.tsx" },
        status: "running",
      },
    ]);
  });
});
