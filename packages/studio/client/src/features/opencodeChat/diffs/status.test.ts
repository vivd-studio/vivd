import { describe, expect, it } from "vitest";
import { formatFileDiffStatus, resolveFileDiffStatus } from "./status";

describe("resolveFileDiffStatus", () => {
  it("returns an explicit added status unchanged", () => {
    expect(
      resolveFileDiffStatus({
        status: "added",
        before: "existing text",
        after: "",
      }),
    ).toBe("added");
  });

  it("infers added when there is only after content", () => {
    expect(
      resolveFileDiffStatus({
        before: "",
        after: "new file",
      }),
    ).toBe("added");
  });

  it("infers deleted when there is only before content", () => {
    expect(
      resolveFileDiffStatus({
        before: "old file",
        after: "",
      }),
    ).toBe("deleted");
  });

  it("defaults to modified when there is no add/remove signal", () => {
    expect(
      resolveFileDiffStatus({
        before: "before",
        after: "after",
      }),
    ).toBe("modified");
  });
});

describe("formatFileDiffStatus", () => {
  it("formats deleted status as removed for display", () => {
    expect(formatFileDiffStatus("deleted")).toBe("Removed");
  });
});
