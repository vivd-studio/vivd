import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageGeneration } from "./OpenRouterImageService.js";

describe("createImageGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces a clear timeout error when provider requests abort", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    await expect(
      createImageGeneration("test-key", {
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        timeoutMs: 10,
      }),
    ).rejects.toThrow("timed out");
  });
});
