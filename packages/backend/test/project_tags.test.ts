import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_TAGS,
  ProjectTagsValidationError,
  normalizeProjectTags,
} from "../src/services/project/projectTags";

describe("normalizeProjectTags", () => {
  it("normalizes, deduplicates, and strips empty values", () => {
    expect(
      normalizeProjectTags([
        "  #Marketing ",
        "marketing",
        "SEO",
        "  ",
        "in progress",
      ]),
    ).toEqual(["marketing", "seo", "in progress"]);
  });

  it("throws when a tag exceeds the max length", () => {
    expect(() =>
      normalizeProjectTags(["x".repeat(33)]),
    ).toThrow(ProjectTagsValidationError);
  });

  it("throws when the number of unique tags exceeds the limit", () => {
    const tooMany = Array.from(
      { length: MAX_PROJECT_TAGS + 1 },
      (_, i) => `tag-${i + 1}`,
    );
    expect(() => normalizeProjectTags(tooMany)).toThrow(
      ProjectTagsValidationError,
    );
  });
});
