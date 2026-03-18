import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveStudioRuntimeUrl } from "./studioRuntimeUrl";

describe("resolveStudioRuntimeUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps path-mounted runtimes on the current host", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost",
      },
    });

    expect(
      resolveStudioRuntimeUrl(
        "http://app.localhost/_studio/runtime-123",
        "vivd-studio",
      ),
    ).toBe("http://localhost/_studio/runtime-123/vivd-studio");
  });

  it("preserves the provided origin for non path-mounted runtimes", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost",
      },
    });

    expect(
      resolveStudioRuntimeUrl("https://studio.example.com/runtime-123", "vivd-studio"),
    ).toBe("https://studio.example.com/runtime-123/vivd-studio");
  });
});
