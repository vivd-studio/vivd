import { describe, it, expect } from "vitest";
import { parseJsonFromLLM, cleanText } from "../src/generator/utils";

describe("Generator Utils", () => {
  describe("parseJsonFromLLM", () => {
    it("parses valid JSON directly", () => {
      const result = parseJsonFromLLM('{"key": "value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("extracts JSON from markdown code block", () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = parseJsonFromLLM(input);
      expect(result).toEqual({ key: "value" });
    });

    it("handles arrays", () => {
      const result = parseJsonFromLLM("[1, 2, 3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("returns null for non-JSON content", () => {
      const result = parseJsonFromLLM("Just some text");
      expect(result).toBeNull();
    });

    it("returns null for null input", () => {
      const result = parseJsonFromLLM(null);
      expect(result).toBeNull();
    });

    it("handles JSON embedded in text", () => {
      const input = 'Here is the result: {"key": "value"} and some more text';
      const result = parseJsonFromLLM(input);
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("cleanText", () => {
    it("normalizes Windows line endings", () => {
      const input = "Line 1\r\nLine 2\r\nLine 3";
      const result = cleanText(input);
      expect(result).toBe("Line 1\nLine 2\nLine 3");
    });

    it("replaces non-breaking spaces", () => {
      const input = "Text\u00A0with\u00A0nbsp";
      const result = cleanText(input);
      expect(result).toBe("Text with nbsp");
    });

    it("trims each line", () => {
      const input = "  Line 1  \n  Line 2  ";
      const result = cleanText(input);
      expect(result).toBe("Line 1\nLine 2");
    });

    it("collapses multiple blank lines", () => {
      const input = "Line 1\n\n\n\n\nLine 2";
      const result = cleanText(input);
      expect(result).toBe("Line 1\n\nLine 2");
    });

    it("trims leading and trailing whitespace", () => {
      const input = "  \n\n  Content  \n\n  ";
      const result = cleanText(input);
      expect(result).toBe("Content");
    });
  });
});
