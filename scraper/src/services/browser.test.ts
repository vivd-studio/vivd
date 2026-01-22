import { describe, it, expect } from "vitest";
import { isBrowserError } from "./browser.js";

describe("isBrowserError", () => {
  describe("should return true for browser/protocol errors", () => {
    const browserErrors = [
      "ProtocolError: Runtime.callFunctionOn timed out",
      "ProtocolError: Runtime.evaluate timed out",
      "ProtocolError: Network.enable timed out",
      "TimeoutError: Navigation timeout of 60000 ms exceeded",
      "TimeoutError: Timed out after waiting 30000ms",
      "Error: Protocol error (Runtime.callFunctionOn): Target closed",
      "Error: Session closed. Most likely the page has been closed",
      "Error: Connection closed",
      "Error: Browser disconnected",
      "Error: browser has disconnected",
      // Mixed case
      "PROTOCOL error occurred",
      "Something TIMED OUT here",
    ];

    for (const message of browserErrors) {
      it(`detects: "${message.substring(0, 50)}..."`, () => {
        const error = new Error(message);
        expect(isBrowserError(error)).toBe(true);
      });
    }
  });

  describe("should return false for non-browser errors", () => {
    const nonBrowserErrors = [
      "SyntaxError: Unexpected token",
      "TypeError: Cannot read property 'foo' of undefined",
      "ReferenceError: x is not defined",
      "Error: ENOENT: no such file or directory",
      "Error: fetch failed",
      "Error: 404 Not Found",
      "Error: Invalid URL",
      "",
    ];

    for (const message of nonBrowserErrors) {
      it(`ignores: "${message || "(empty)"}"`, () => {
        const error = new Error(message);
        expect(isBrowserError(error)).toBe(false);
      });
    }
  });

  describe("should handle non-Error inputs", () => {
    it("returns false for null", () => {
      expect(isBrowserError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isBrowserError(undefined)).toBe(false);
    });

    it("returns false for string", () => {
      expect(isBrowserError("protocol error")).toBe(false);
    });

    it("returns false for number", () => {
      expect(isBrowserError(500)).toBe(false);
    });

    it("returns false for plain object", () => {
      expect(isBrowserError({ message: "protocol error" })).toBe(false);
    });
  });
});
