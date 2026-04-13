import { describe, expect, it } from "vitest";
import { collectVivdTextPatchesFromDocument } from "./vivdPreviewTextPatching";

describe("collectVivdTextPatchesFromDocument", () => {
  it("writes CMS-bound text edits back to the owning field", () => {
    const wrapper = document.createElement("p");
    wrapper.setAttribute("data-cms-collection", "horse");
    wrapper.setAttribute("data-cms-entry", "apollo");
    wrapper.setAttribute("data-cms-field", "description");

    const editable = document.createElement("span");
    editable.setAttribute("data-vivd-text-parent-selector", "/html/body/p[1]");
    editable.setAttribute("data-vivd-text-node-index", "1");
    editable.setAttribute("data-vivd-text-baseline", "Elegant horse");
    editable.textContent = "Elegant horse for dressage";

    wrapper.appendChild(editable);
    document.body.appendChild(wrapper);

    expect(collectVivdTextPatchesFromDocument(document)).toEqual([
      {
        type: "setCmsField",
        modelKey: "horse",
        entryKey: "apollo",
        fieldPath: ["description"],
        value: "Elegant horse for dressage",
      },
    ]);

    wrapper.remove();
  });

  it("appends locale for localized CMS text bindings", () => {
    const wrapper = document.createElement("h2");
    wrapper.setAttribute("data-cms-collection", "pages");
    wrapper.setAttribute("data-cms-entry", "home");
    wrapper.setAttribute("data-cms-field", "hero.title");
    wrapper.setAttribute("data-cms-locale", "de");

    const editable = document.createElement("span");
    editable.setAttribute("data-vivd-text-parent-selector", "/html/body/h2[1]");
    editable.setAttribute("data-vivd-text-node-index", "1");
    editable.setAttribute("data-vivd-text-baseline", "Welcome");
    editable.textContent = "Willkommen";

    wrapper.appendChild(editable);
    document.body.appendChild(wrapper);

    expect(collectVivdTextPatchesFromDocument(document)).toEqual([
      {
        type: "setCmsField",
        modelKey: "pages",
        entryKey: "home",
        fieldPath: ["hero", "title", "de"],
        value: "Willkommen",
      },
    ]);

    wrapper.remove();
  });

  it("prefers the current document language over stale localStorage for i18n edits", () => {
    document.documentElement.setAttribute("lang", "en");
    window.localStorage.setItem("lang", "de");

    const wrapper = document.createElement("h1");
    wrapper.setAttribute("data-i18n", "hero.title");

    const editable = document.createElement("span");
    editable.setAttribute("data-vivd-text-parent-selector", "/html/body/h1[1]");
    editable.setAttribute("data-vivd-text-node-index", "1");
    editable.setAttribute("data-vivd-text-baseline", "Find your horse");
    editable.setAttribute("data-vivd-i18n-key", "hero.title");
    editable.textContent = "Find your perfect horse";

    wrapper.appendChild(editable);
    document.body.appendChild(wrapper);

    expect(collectVivdTextPatchesFromDocument(document)).toEqual([
      {
        type: "setI18n",
        key: "hero.title",
        lang: "en",
        value: "Find your perfect horse",
      },
    ]);

    wrapper.remove();
    window.localStorage.clear();
    document.documentElement.removeAttribute("lang");
  });
});
