import { describe, expect, it } from "vitest";
import { CHECKLIST_ITEMS, CHECKLIST_PROMPT } from "./checklistTypes.js";

describe("checklistTypes", () => {
  it("keeps the SEO checklist item explicit about share previews", () => {
    expect(CHECKLIST_ITEMS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "seo_meta",
          label: expect.stringContaining("social preview image"),
        }),
      ]),
    );
  });

  it("asks the checklist agent to verify og:image and flag generic logo fallbacks", () => {
    expect(CHECKLIST_PROMPT).toContain("og:image");
    expect(CHECKLIST_PROMPT).toContain("share-preview image");
    expect(CHECKLIST_PROMPT).toContain("generic logo/icon fallback");
  });
});
