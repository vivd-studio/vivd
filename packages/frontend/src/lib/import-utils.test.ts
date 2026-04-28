import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getImportErrorToastDescription,
  importProjectZip,
  ZIP_IMPORT_MAX_FILE_SIZE_BYTES,
} from "./import-utils";

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
    ).rejects.toThrow("ZIP file is too large. Maximum size is 250MB.");
  });

  it("surfaces backend JSON errors for 413 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "ZIP file is too large. Maximum size is 250MB." }),
        {
          status: 413,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      importProjectZip(new File(["zip"], "site.zip", { type: "application/zip" })),
    ).rejects.toThrow("ZIP file is too large. Maximum size is 250MB.");
  });

  it("rejects oversized ZIPs before starting the upload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const largeFile = {
      name: "site.zip",
      size: ZIP_IMPORT_MAX_FILE_SIZE_BYTES + 1,
    } as File;

    await expect(importProjectZip(largeFile)).rejects.toThrow(
      "ZIP file is too large. Maximum size is 250MB.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getImportErrorToastDescription", () => {
  it("maps post-create import failures to a user-facing project-card hint", () => {
    expect(
      getImportErrorToastDescription(
        new Error(
          "Import failed after the project was created. The project was kept with failed status.",
        ),
      ),
    ).toBe(
      "The project was created, but setup failed. Check the project card for details.",
    );
  });
});
