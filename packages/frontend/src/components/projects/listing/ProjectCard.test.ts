import { describe, expect, it } from "vitest";
import {
  getDefaultManualProjectStatus,
  getManualProjectStatusOptions,
  isStudioAccessibleProjectStatus,
} from "./ProjectCard";

describe("isStudioAccessibleProjectStatus", () => {
  it("keeps interrupted scratch/studio states openable in Studio", () => {
    expect(isStudioAccessibleProjectStatus("starting_studio")).toBe(true);
    expect(isStudioAccessibleProjectStatus("generating_initial_site")).toBe(true);
    expect(isStudioAccessibleProjectStatus("initial_generation_paused")).toBe(true);
    expect(isStudioAccessibleProjectStatus("failed")).toBe(true);
    expect(isStudioAccessibleProjectStatus("completed")).toBe(true);
  });

  it("does not expose pre-studio processing states as Studio-openable", () => {
    expect(isStudioAccessibleProjectStatus("pending")).toBe(false);
    expect(isStudioAccessibleProjectStatus("scraping")).toBe(false);
    expect(isStudioAccessibleProjectStatus("generating_html")).toBe(false);
    expect(isStudioAccessibleProjectStatus("unknown")).toBe(false);
  });
});

describe("getManualProjectStatusOptions", () => {
  it("offers paused only for scratch projects", () => {
    expect(getManualProjectStatusOptions("scratch").map((option) => option.value)).toEqual([
      "completed",
      "failed",
      "initial_generation_paused",
    ]);
    expect(getManualProjectStatusOptions("url").map((option) => option.value)).toEqual([
      "completed",
      "failed",
    ]);
  });
});

describe("getDefaultManualProjectStatus", () => {
  it("preserves current overrideable statuses when they are valid for the project", () => {
    expect(getDefaultManualProjectStatus("failed", "url")).toBe("failed");
    expect(getDefaultManualProjectStatus("completed", "scratch")).toBe("completed");
    expect(getDefaultManualProjectStatus("initial_generation_paused", "scratch")).toBe(
      "initial_generation_paused",
    );
  });

  it("falls back to the safest default for non-overrideable statuses", () => {
    expect(getDefaultManualProjectStatus("processing", "scratch")).toBe(
      "initial_generation_paused",
    );
    expect(getDefaultManualProjectStatus("initial_generation_paused", "url")).toBe(
      "failed",
    );
  });
});
