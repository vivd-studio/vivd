import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import {
  detectActiveLanguage,
  getI18nKeyForEditableElement,
  serializeI18nElementValue,
  collectVivdTextPatchesFromDocument,
} from "./vivdPreviewTextPatching";

describe("detectActiveLanguage", () => {
  it('returns "en" as default when no language indicators', () => {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    const result = detectActiveLanguage(dom.window.document);
    expect(result).toBe("en");
  });

  it("detects language from html lang attribute", () => {
    const dom = new JSDOM(
      '<!DOCTYPE html><html lang="de"><body></body></html>'
    );
    const result = detectActiveLanguage(dom.window.document);
    expect(result).toBe("de");
  });

  it("normalizes language with region code to base language", () => {
    const dom = new JSDOM(
      '<!DOCTYPE html><html lang="de-DE"><body></body></html>'
    );
    const result = detectActiveLanguage(dom.window.document);
    expect(result).toBe("de");
  });

  it("detects language from lang toggle element with font-bold class", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="lang-en">EN</button>
          <button id="lang-de" class="font-bold">DE</button>
        </body>
      </html>
    `);
    const result = detectActiveLanguage(dom.window.document);
    expect(result).toBe("de");
  });

  it("detects language from lang toggle element with aria-current", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <button id="lang-en">EN</button>
          <button id="lang-fr" aria-current="true">FR</button>
        </body>
      </html>
    `);
    const result = detectActiveLanguage(dom.window.document);
    expect(result).toBe("fr");
  });
});

describe("getI18nKeyForEditableElement", () => {
  it("returns data-i18n attribute from element", () => {
    const dom = new JSDOM(`
      <html><body>
        <span data-i18n="hero.title">Hello</span>
      </body></html>
    `);
    const el = dom.window.document.querySelector("span") as HTMLElement;
    expect(getI18nKeyForEditableElement(el)).toBe("hero.title");
  });

  it("returns data-i18n from closest ancestor", () => {
    const dom = new JSDOM(`
      <html><body>
        <div data-i18n="hero.title">
          <span id="target">Hello</span>
        </div>
      </body></html>
    `);
    const el = dom.window.document.getElementById("target") as HTMLElement;
    expect(getI18nKeyForEditableElement(el)).toBe("hero.title");
  });

  it("returns null when no i18n key found", () => {
    const dom = new JSDOM(`
      <html><body>
        <span id="target">Hello</span>
      </body></html>
    `);
    const el = dom.window.document.getElementById("target") as HTMLElement;
    expect(getI18nKeyForEditableElement(el)).toBeNull();
  });
});

describe("serializeI18nElementValue", () => {
  it("returns text content for simple text", () => {
    const dom = new JSDOM(`
      <html><body>
        <span id="target">Hello World</span>
      </body></html>
    `);
    const el = dom.window.document.getElementById("target") as HTMLElement;
    expect(serializeI18nElementValue(el)).toBe("Hello World");
  });

  it("returns innerHTML for elements with markup", () => {
    const dom = new JSDOM(`
      <html><body>
        <span id="target"><strong>Hello</strong> World</span>
      </body></html>
    `);
    const el = dom.window.document.getElementById("target") as HTMLElement;
    expect(serializeI18nElementValue(el)).toBe("<strong>Hello</strong> World");
  });

  it("removes contenteditable attributes during serialization", () => {
    const dom = new JSDOM(`
      <html><body>
        <span id="target"><span contenteditable="true">Hello</span></span>
      </body></html>
    `);
    const el = dom.window.document.getElementById("target") as HTMLElement;
    const result = serializeI18nElementValue(el);
    expect(result).not.toContain("contenteditable");
  });

  it("replaces helper spans with plain text", () => {
    const dom = new JSDOM(`
      <html><body>
        <span id="target">
          <span data-vivd-text-parent-selector="test" data-vivd-text-node-index="1">Wrapped</span>
        </span>
      </body></html>
    `);
    const el = dom.window.document.getElementById("target") as HTMLElement;
    const result = serializeI18nElementValue(el);
    expect(result).not.toContain("data-vivd-text-parent-selector");
    expect(result).toContain("Wrapped");
  });
});

describe("collectVivdTextPatchesFromDocument", () => {
  it("returns empty array for document with no edits", () => {
    const dom = new JSDOM(
      "<!DOCTYPE html><html><body><p>Hello</p></body></html>"
    );
    const patches = collectVivdTextPatchesFromDocument(dom.window.document);
    expect(patches).toEqual([]);
  });

  it("detects text node patch when baseline differs from current", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <p data-vivd-selector="#id-p">
            <span 
              data-vivd-text-parent-selector="#id-p" 
              data-vivd-text-node-index="1"
              data-vivd-text-baseline="Original"
            >Modified</span>
          </p>
        </body>
      </html>
    `);
    const patches = collectVivdTextPatchesFromDocument(dom.window.document);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({
      type: "setTextNode",
      selector: "#id-p",
      index: 1,
      value: "Modified",
    });
  });

  it("skips nodes where baseline matches current text", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <p data-vivd-selector="#id-p">
            <span 
              data-vivd-text-parent-selector="#id-p" 
              data-vivd-text-node-index="1"
              data-vivd-text-baseline="Same"
            >Same</span>
          </p>
        </body>
      </html>
    `);
    const patches = collectVivdTextPatchesFromDocument(dom.window.document);
    expect(patches).toEqual([]);
  });

  it("creates Astro patch when source file is present", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <p>
            <span 
              data-vivd-text-parent-selector="#id-p" 
              data-vivd-text-node-index="1"
              data-vivd-text-baseline="Original"
              data-vivd-source-file="src/components/Hero.astro"
              data-vivd-source-loc="18:8"
            >Modified</span>
          </p>
        </body>
      </html>
    `);
    const patches = collectVivdTextPatchesFromDocument(dom.window.document);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({
      type: "setAstroText",
      sourceFile: "src/components/Hero.astro",
      sourceLoc: "18:8",
      oldValue: "Original",
      newValue: "Modified",
    });
  });

  it("creates i18n patch when data-i18n key is present", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html lang="en">
        <body>
          <h1 data-i18n="hero.title" data-vivd-selector="#id-h1">
            <span 
              data-vivd-text-parent-selector="#id-h1" 
              data-vivd-text-node-index="1"
              data-vivd-text-baseline="Original"
              data-vivd-i18n-key="hero.title"
            >Modified Title</span>
          </h1>
        </body>
      </html>
    `);
    const patches = collectVivdTextPatchesFromDocument(dom.window.document);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.type).toBe("setI18n");
    expect((patches[0] as any).key).toBe("hero.title");
    expect((patches[0] as any).lang).toBe("en");
  });
});
