import { describe, it, expect } from "vitest";
import { extractHtmlFromText } from "../src/generator/utils";

describe("extractHtmlFromText", () => {
  const testCases = [
    {
      name: "Standard Markdown Block",
      input:
        '```html\n<!DOCTYPE html>\n<html lang="en">\n<body>Standard</body>\n</html>\n```',
      expectedContains: ["<!DOCTYPE html>", "<html", "Standard"],
    },
    {
      name: "Truncated Markdown (No closing ticks)",
      input:
        '```html\n<!DOCTYPE html>\n<html lang="de" class="scroll-smooth">\n<body>Truncated</body>\n</html>',
      expectedContains: ["<!DOCTYPE html>", "<html", "Truncated"],
    },
    {
      name: "Missing DOCTYPE (should match html tags)",
      input: "<html>\n<body>No Doctype</body>\n</html>",
      expectedContains: ["<html>", "No Doctype"],
    },
    {
      name: "Wrong case HTML tag in markdown",
      input: '```HTML\n<!DOCTYPE html>\n<html lang="en">\n</html>\n```',
      expectedContains: ["<!DOCTYPE html>", "<html"],
    },
    {
      name: "Unknown language identifier",
      input: "```custom-lang\n<!DOCTYPE html>\n<html>Content</html>\n```",
      expectedContains: ["<!DOCTYPE html>", "Content"],
    },
    {
      name: "Malformed text starts with ``` but valid inside",
      input: '```html\n<!DOCTYPE html>\n<html lang="de">...</html>',
      expectedContains: ["<!DOCTYPE html>", "<html"],
    },
    {
      name: "User Snippet (Reconstructed)",
      input:
        '```html\n<!DOCTYPE html>\n<html lang="de" class="scroll-smooth">\n<head></head>\n<body></body>\n</html>\n```',
      expectedContains: ["<!DOCTYPE html>", "scroll-smooth"],
    },
  ];

  testCases.forEach((tc) => {
    it(tc.name, () => {
      const result = extractHtmlFromText(tc.input);

      // Result should not contain markdown ticks at start
      expect(result.trim().startsWith("```")).toBe(false);

      // Check expected content
      for (const expected of tc.expectedContains) {
        expect(result).toContain(expected);
      }
    });
  });
});
