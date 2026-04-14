import { afterEach, describe, expect, it, vi } from "vitest";

import { importProjectZip } from "./import-utils";

describe("importProjectZip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces backend JSON errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Only .zip files are supported" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      importProjectZip(new File(["zip"], "site.zip", { type: "application/zip" })),
    ).rejects.toThrow("Only .zip files are supported");
  });

  it("falls back to a clear size-limit message for non-JSON 413 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><body>Payload Too Large</body></html>", {
        status: 413,
        headers: {
          "Content-Type": "text/html",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      importProjectZip(new File(["zip"], "site.zip", { type: "application/zip" })),
    ).rejects.toThrow("ZIP file is too large. Maximum size is 100MB.");
  });
});
