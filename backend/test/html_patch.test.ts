import { describe, it, expect } from "vitest";
import {
  applyHtmlPatches,
  type HtmlPatch,
} from "../src/services/HtmlPatchService";

describe("HtmlPatchService", () => {
  describe("applyHtmlPatches", () => {
    describe("setTextNode patches", () => {
      it("replaces text content in a simple element", () => {
        const html = `<!DOCTYPE html><html><body><p>Original text</p></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: "/p[1]",
            index: 1,
            value: "New text",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.skipped).toBe(0);
        expect(result.html).toContain("New text");
        expect(result.html).not.toContain("Original text");
      });

      it("handles nested elements with path selector", () => {
        const html = `<!DOCTYPE html><html><body><div><section><p>Nested text</p></section></div></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: "/div[1]/section[1]/p[1]",
            index: 1,
            value: "Updated",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.html).toContain("Updated");
      });

      it("resolves elements by ID selector", () => {
        const html = `<!DOCTYPE html><html><body><p id="target">Find me</p></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: '//*[@id="target"]',
            index: 1,
            value: "Found",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.html).toContain("Found");
      });

      it("skips patch when element is not found", () => {
        const html = `<!DOCTYPE html><html><body><p>Text</p></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: "/div[1]",
            index: 1,
            value: "Never applied",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(0);
        expect(result.skipped).toBe(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.reason).toContain("not found");
      });

      it("skips patch when text node index is out of bounds", () => {
        const html = `<!DOCTYPE html><html><body><p>Only one text node</p></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: "/p[1]",
            index: 5,
            value: "Never applied",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(0);
        expect(result.skipped).toBe(1);
      });

      it("escapes HTML entities in replacement text", () => {
        const html = `<!DOCTYPE html><html><body><p>Original</p></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: "/p[1]",
            index: 1,
            value: '<script>alert("xss")</script>',
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.html).toContain("&lt;script&gt;");
        expect(result.html).not.toContain("<script>");
      });

      it("preserves whitespace around text content", () => {
        const html = `<!DOCTYPE html><html><body><p>  Original  </p></body></html>`;
        const patches: HtmlPatch[] = [
          { type: "setTextNode", selector: "/p[1]", index: 1, value: "New" },
        ];

        const result = applyHtmlPatches(html, patches);

        // Should preserve the original whitespace structure
        expect(result.applied).toBe(1);
        expect(result.html).toContain("New");
      });
    });

    describe("setAttr patches", () => {
      it("updates an existing attribute", () => {
        const html = `<!DOCTYPE html><html><body><a href="old.html">Link</a></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setAttr",
            selector: "/a[1]",
            name: "href",
            value: "new.html",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.html).toContain('href="new.html"');
        expect(result.html).not.toContain("old.html");
      });

      it("adds a new attribute when not present", () => {
        const html = `<!DOCTYPE html><html><body><div>Content</div></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setAttr",
            selector: "/div[1]",
            name: "class",
            value: "new-class",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.html).toContain('class="new-class"');
      });

      it("escapes quotes in attribute values", () => {
        const html = `<!DOCTYPE html><html><body><div title="old">Content</div></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setAttr",
            selector: "/div[1]",
            name: "title",
            value: 'He said "hello"',
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.html).toContain("&quot;hello&quot;");
      });
    });

    describe("multiple patches", () => {
      it("applies multiple patches to different elements", () => {
        const html = `<!DOCTYPE html><html><body><h1>Title</h1><p>Paragraph</p></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: "/h1[1]",
            index: 1,
            value: "New Title",
          },
          {
            type: "setTextNode",
            selector: "/p[1]",
            index: 1,
            value: "New Paragraph",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(2);
        expect(result.html).toContain("New Title");
        expect(result.html).toContain("New Paragraph");
      });

      it("deduplicates identical patches", () => {
        const html = `<!DOCTYPE html><html><body><p>Original</p></body></html>`;
        const patches: HtmlPatch[] = [
          { type: "setTextNode", selector: "/p[1]", index: 1, value: "New" },
          { type: "setTextNode", selector: "/p[1]", index: 1, value: "Newer" }, // Same target, should override
        ];

        const result = applyHtmlPatches(html, patches);

        // Last patch wins
        expect(result.html).toContain("Newer");
        expect(result.html).not.toContain("Original");
      });

      it("skips unchanged content", () => {
        const html = `<!DOCTYPE html><html><body><p>Same</p></body></html>`;
        const patches: HtmlPatch[] = [
          { type: "setTextNode", selector: "/p[1]", index: 1, value: "Same" },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(0);
        expect(result.skipped).toBe(1);
      });
    });

    describe("edge cases", () => {
      it("handles empty patch array", () => {
        const html = `<!DOCTYPE html><html><body><p>Text</p></body></html>`;
        const result = applyHtmlPatches(html, []);

        expect(result.applied).toBe(0);
        expect(result.skipped).toBe(0);
        expect(result.html).toBe(html);
      });

      it("handles self-closing tags", () => {
        const html = `<!DOCTYPE html><html><body><img src="old.jpg" /></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setAttr",
            selector: "/img[1]",
            name: "src",
            value: "new.jpg",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(1);
        expect(result.html).toContain("new.jpg");
      });

      it("handles invalid selector gracefully", () => {
        const html = `<!DOCTYPE html><html><body><p>Text</p></body></html>`;
        const patches: HtmlPatch[] = [
          {
            type: "setTextNode",
            selector: "!!!invalid!!!",
            index: 1,
            value: "Test",
          },
        ];

        const result = applyHtmlPatches(html, patches);

        expect(result.applied).toBe(0);
        expect(result.skipped).toBe(1);
      });
    });
  });
});
