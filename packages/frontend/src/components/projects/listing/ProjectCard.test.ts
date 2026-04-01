import { describe, expect, it } from "vitest";
import { isStudioAccessibleProjectStatus } from "./ProjectCard";

describe("isStudioAccessibleProjectStatus", () => {
  it("keeps interrupted scratch/studio states openable in Studio", () => {
    expect(isStudioAccessibleProjectStatus("starting_studio")).toBe(true);
    expect(isStudioAccessibleProjectStatus("generating_initial_site")).toBe(true);
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
