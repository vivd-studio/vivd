import { describe, expect, it } from "vitest";
import {
  parseCmsFieldPath,
  readCmsBindingFromElement,
} from "./cmsPreviewBindings";

describe("cmsPreviewBindings", () => {
  it("parses dotted and indexed CMS field paths", () => {
    expect(parseCmsFieldPath("title")).toEqual(["title"]);
    expect(parseCmsFieldPath("galleryImages[2]")).toEqual(["galleryImages", 2]);
    expect(parseCmsFieldPath("sections[1].cta.label")).toEqual([
      "sections",
      1,
      "cta",
      "label",
    ]);
  });

  it("reads neutral data-cms bindings from the nearest ancestor and appends locale", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-cms-collection", "posts");
    wrapper.setAttribute("data-cms-entry", "welcome");
    wrapper.setAttribute("data-cms-field", "seo.title");
    wrapper.setAttribute("data-cms-kind", "text");
    wrapper.setAttribute("data-cms-locale", "de");

    const child = document.createElement("span");
    wrapper.appendChild(child);

    expect(readCmsBindingFromElement(child)).toEqual({
      modelKey: "posts",
      entryKey: "welcome",
      fieldPath: ["seo", "title", "de"],
      kind: "text",
    });
  });
});
